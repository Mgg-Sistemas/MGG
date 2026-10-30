-- ============================================================
-- MGG · Compras · Revisión de ALMACÉN por SEDE (30-10-2026)
--
-- Regla de la administradora: «Los almacenistas deben confirmar desde LOS
-- PINOS y MATANZA si tienen o no los productos que piden por la OP».
--
--   PEDIDO → ALMACÉN → cada almacén (Los Pinos, Matanza) responde por renglón
--   SÍ (lo entrega ese almacén) / NO; lo que ninguno tiene va a Compras.
--
-- Datos:
--   · por renglón `almacen_sedes` = { "<sede>": { disponible, revisado, por, en } }
--     (cada sede guarda SOLO lo suyo: marcar en Los Pinos no toca Matanza).
--   · por SP `revision_sedes` = { "<sede>": { confirmada_por, confirmada_en, nota } }.
--   · Cuando TODAS las sedes de `almacen_sedes_revision()` confirmaron, la base
--     cierra sola: por renglón cantidad_almacen = min(Σ disponibles, solicitada),
--     `almacen_origenes` = cuánto da cada sede (Los Pinos primero, después
--     Matanza, hasta lo pedido), cantidad = lo que falta, comprar = falta > 0;
--     la SP pasa a `pendiente` (Compras) o `atendida_almacen`.
--
-- Reemplaza la firma del 29-10 (uuid, jsonb, boolean, text). El flujo sigue
-- APAGADO tras `config.compras.revision_almacen` y no había SP en revisión.
-- ============================================================

alter table public.ordenes add column if not exists revision_sedes jsonb;

comment on column public.ordenes.revision_sedes is
  'Revisión de almacén por sede (30-10-2026): { "<sede>": { confirmada_por, confirmada_en, nota } }.';

-- Las sedes cuyo almacén confirma, en el ORDEN en que se reparte la entrega.
-- Para sumar La Esperanza: agregarla acá y en SEDES_REVISION_ALMACEN
-- (src/modules/pedidos/revisionAlmacen.ts).
create or replace function public.almacen_sedes_revision()
returns text[]
language sql
immutable
set search_path = ''
as $$ select array['LOS PINOS', 'CENTRO DE FUNDICION - MATANZAS']::text[] $$;

-- Cómo se nombra la sede en mensajes e historial.
create or replace function public.almacen_etiqueta_sede(p_sede text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case btrim(coalesce(p_sede, ''))
    when 'LOS PINOS' then 'Los Pinos'
    when 'CENTRO DE FUNDICION - MATANZAS' then 'Matanza'
    when 'CENTRO DE ACOPIO - LA ESPERANZA' then 'La Esperanza'
    else initcap(btrim(coalesce(p_sede, '')))
  end
$$;

revoke all on function public.almacen_sedes_revision() from public, anon;
revoke all on function public.almacen_etiqueta_sede(text) from public, anon;
grant execute on function public.almacen_sedes_revision() to authenticated;
grant execute on function public.almacen_etiqueta_sede(text) to authenticated;

drop function if exists public.almacen_revisar_solicitud(uuid, jsonb, boolean, text);

-- Guarda lo que UNA sede va marcando y, con p_confirmar, confirma su revisión.
-- p_items: [{ "sku": "...", "disponible": 3, "revisado": true }, ...]
-- Security definer: solo toca SP en `revision_almacen`, solo quien escribe en
-- Inventario o en Salidas (el almacenista), y un almacenista sectorizado solo
-- responde por SU sede (`usuarios.sedes_asignadas`; null/vacío = sin restricción).
create or replace function public.almacen_revisar_solicitud(
  p_orden_id uuid,
  p_sede text,
  p_items jsonb default '[]'::jsonb,
  p_confirmar boolean default false,
  p_nota text default null
) returns public.ordenes
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.ordenes;
  it jsonb;
  r jsonb;
  v_sedes text[] := public.almacen_sedes_revision();
  v_sede text := btrim(coalesce(p_sede, ''));
  v_etq text;
  v_mias text[];
  v_email text;
  v_ahora timestamptz := now();
  v_items jsonb := '[]'::jsonb;
  v_marcados jsonb;
  v_ms jsonb;
  v_conf jsonb;
  v_sol numeric;
  v_d numeric;
  v_rest numeric;
  v_disp numeric;
  v_falta numeric;
  v_orig jsonb;
  v_cuenta jsonb := '{}'::jsonb;
  v_n int := 0;
  v_pend int := 0;
  v_tiene int := 0;
  v_hay_compra boolean := false;
  v_total numeric := 0;
  v_todas boolean;
  v_estado public.estado_orden;
  v_detalle text;
  v_entrega text;
  v_nota text;
  s text;
begin
  -- Inventario (escritura) o Salidas (escritura): el rol almacenista tiene Inventario en
  -- solo lectura y escribe por Salidas (ejecuta las entregas), y es quien responde acá.
  if not (public.is_admin() or public.puede_modulo('inventario', 'escritura')
          or public.puede_modulo('salidas', 'escritura')) then
    raise exception 'Sin permiso para revisar solicitudes de pedido en almacén.' using errcode = '42501';
  end if;

  if not (v_sede = any(v_sedes)) then
    raise exception 'La sede «%» no revisa solicitudes de pedido.', v_sede using errcode = 'P0001';
  end if;
  v_etq := public.almacen_etiqueta_sede(v_sede);

  select email, sedes_asignadas into v_email, v_mias from public.usuarios where id = auth.uid();
  -- Sectorizado (sedes_asignadas con algo) = solo responde por su sede. null/vacío = sin restricción.
  if coalesce(cardinality(v_mias), 0) > 0 and not (v_sede = any(v_mias)) then
    raise exception 'Solo puedes responder por tu sede (%): no por %.', array_to_string(v_mias, ', '), v_etq
      using errcode = '42501';
  end if;

  select * into o from public.ordenes where id = p_orden_id for update;
  if not found then
    raise exception 'Solicitud de pedido no encontrada.';
  end if;
  if o.estado <> 'revision_almacen' then
    raise exception 'La solicitud % ya no está en revisión de almacén (estado: %).', o.codigo, o.estado
      using errcode = 'P0001';
  end if;

  v_conf := case when jsonb_typeof(o.revision_sedes) = 'object' then o.revision_sedes else '{}'::jsonb end;
  if v_conf ? v_sede then
    if p_confirmar or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 0 then
      raise exception '% ya confirmó su revisión de %.', v_etq, o.codigo using errcode = 'P0001';
    end if;
    return o;
  end if;

  -- 1. Las marcas de ESTA sede (las de la otra quedan como están).
  for it in select value from jsonb_array_elements(coalesce(o.items, '[]'::jsonb)) loop
    -- Lo que la SP ya trae desmarcado (comprar = false) no se pide: queda igual.
    if not coalesce((it->>'comprar')::boolean, true) then
      v_items := v_items || jsonb_build_array(it);
      continue;
    end if;
    v_sol := coalesce(nullif(it->>'cantidad_solicitada', '')::numeric, nullif(it->>'cantidad', '')::numeric, 0);
    v_ms := case when jsonb_typeof(it->'almacen_sedes') = 'object' then it->'almacen_sedes' else '{}'::jsonb end;

    r := null;
    select x into r from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
      where x->>'sku' = it->>'sku' limit 1;
    if r is not null then
      v_ms := v_ms || jsonb_build_object(v_sede, jsonb_build_object(
        'disponible', least(greatest(coalesce(nullif(r->>'disponible', '')::numeric, 0), 0), v_sol),
        'revisado', coalesce((r->>'revisado')::boolean, true),
        'por', coalesce(v_email, 'almacen'),
        'en', v_ahora
      ));
      it := it || jsonb_build_object('almacen_sedes', v_ms);
    end if;

    v_n := v_n + 1;
    if not coalesce((v_ms->v_sede->>'revisado')::boolean, false) then
      v_pend := v_pend + 1;
    elsif coalesce(nullif(v_ms->v_sede->>'disponible', '')::numeric, 0) > 0 then
      v_tiene := v_tiene + 1;
    end if;
    v_items := v_items || jsonb_build_array(it);
  end loop;

  if not p_confirmar then
    update public.ordenes set items = v_items where id = o.id returning * into o;
    return o;
  end if;

  -- 2. La sede confirma: todos sus renglones tienen que estar respondidos.
  if v_n = 0 then
    raise exception 'La solicitud % no tiene renglones para revisar.', o.codigo using errcode = 'P0001';
  end if;
  if v_pend > 0 then
    raise exception 'Falta revisar % renglón(es) de % en %.', v_pend, o.codigo, v_etq using errcode = 'P0001';
  end if;

  v_conf := v_conf || jsonb_build_object(v_sede, jsonb_build_object(
    'confirmada_por', coalesce(v_email, 'almacen'),
    'confirmada_en', v_ahora,
    'nota', nullif(btrim(coalesce(p_nota, '')), '')
  ));
  o.historial := coalesce(o.historial, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
    'at', v_ahora,
    'evento', 'revisada_almacen',
    'actor', coalesce(v_email, 'almacen'),
    'sede', v_sede,
    'detalle', format('%s confirmó: tiene %s de %s renglón(es)', v_etq, v_tiene, v_n)
  ));

  select bool_and(v_conf ? x) into v_todas from unnest(v_sedes) x;
  if not coalesce(v_todas, false) then
    update public.ordenes set items = v_items, revision_sedes = v_conf, historial = o.historial
      where id = o.id returning * into o;
    return o;
  end if;

  -- 3. Respondieron todas: se reparte y la SP sale de almacén.
  v_marcados := v_items;
  v_items := '[]'::jsonb;
  for it in select value from jsonb_array_elements(v_marcados) loop
    if not coalesce((it->>'comprar')::boolean, true) then
      v_items := v_items || jsonb_build_array(it);
      continue;
    end if;
    v_sol := coalesce(nullif(it->>'cantidad_solicitada', '')::numeric, nullif(it->>'cantidad', '')::numeric, 0);
    v_rest := v_sol;
    v_disp := 0;
    v_orig := '{}'::jsonb;
    foreach s in array v_sedes loop
      v_d := least(greatest(coalesce(nullif(it->'almacen_sedes'->s->>'disponible', '')::numeric, 0), 0), v_rest);
      if v_d > 0 then
        v_orig := v_orig || jsonb_build_object(s, v_d);
        v_rest := v_rest - v_d;
        v_disp := v_disp + v_d;
        v_cuenta := v_cuenta || jsonb_build_object(s, coalesce((v_cuenta->>s)::int, 0) + 1);
      end if;
    end loop;
    v_falta := greatest(v_sol - v_disp, 0);
    if v_falta > 0 then v_hay_compra := true; end if;
    it := it || jsonb_build_object(
      'cantidad_solicitada', v_sol,
      'cantidad_almacen', v_disp,
      'almacen_origenes', v_orig,
      'almacen_revisado', true,
      'cantidad', v_falta,
      'comprar', v_falta > 0
    );
    v_total := v_total + v_falta * coalesce(nullif(it->>'precio', '')::numeric, 0);
    v_items := v_items || jsonb_build_array(it);
  end loop;

  select string_agg(format('%s %s', public.almacen_etiqueta_sede(x), v_cuenta->>x), ' · ' order by ord)
    into v_entrega
    from unnest(v_sedes) with ordinality as u(x, ord)
    where v_cuenta ? x;
  select string_agg(format('%s: %s', public.almacen_etiqueta_sede(x), v_conf->x->>'nota'), E'\n' order by ord)
    into v_nota
    from unnest(v_sedes) with ordinality as u(x, ord)
    where nullif(btrim(coalesce(v_conf->x->>'nota', '')), '') is not null;

  v_detalle := case when v_hay_compra then 'Revisión completa: pasa a Compras con lo que falta'
                    else 'Revisión completa: almacén tiene todo, no pasa a Compras' end
    || coalesce(' · entrega ' || v_entrega || ' renglón(es)', '');
  v_estado := (case when v_hay_compra then 'pendiente' else 'atendida_almacen' end)::public.estado_orden;

  update public.ordenes set
    items = v_items,
    total = v_total,
    estado = v_estado,
    revision_sedes = v_conf,
    revisada_almacen_por = coalesce(v_email, 'almacen'),
    revisada_almacen_en = v_ahora,
    nota_almacen = v_nota,
    historial = o.historial || jsonb_build_array(jsonb_build_object(
      'at', v_ahora,
      'evento', 'revisada_almacen',
      'actor', coalesce(v_email, 'almacen'),
      'detalle', v_detalle
    ))
  where id = o.id
  returning * into o;
  return o;
end $$;

revoke all on function public.almacen_revisar_solicitud(uuid, text, jsonb, boolean, text) from public, anon;
grant execute on function public.almacen_revisar_solicitud(uuid, text, jsonb, boolean, text) to authenticated;

select
  (select value from public.config where key = 'compras.revision_almacen') as interruptor,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'ordenes'
     and column_name = 'revision_sedes') as columna,
  to_regprocedure('public.almacen_revisar_solicitud(uuid, text, jsonb, boolean, text)') is not null as funcion_nueva,
  to_regprocedure('public.almacen_revisar_solicitud(uuid, jsonb, boolean, text)') is null as vieja_borrada,
  public.almacen_sedes_revision() as sedes;
