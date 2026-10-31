-- ============================================================
-- MGG · Compras · SP: dónde se NECESITA + TRASLADO entre almacenes (30-10-2026)
--
-- Regla de la administradora: «Los Pinos y Matanza confirman el pedido y dicen
-- si tienen o no. Si hay en Los Pinos y no en Matanza, el almacenista de Los
-- Pinos HACE UN TRASLADO con su vista de teléfono y se lo envía a Matanza, y en
-- ese traslado se indica que el pedido lo tiene Los Pinos, stock completo.
-- Puede ocurrir que lo necesiten en Los Pinos o en Matanza.»
--
--   · ordenes.sede_destino: dónde se necesita (se elige al hacer la SP).
--   · El reparto de la revisión entrega PRIMERO desde esa sede (sin traslado);
--     lo que da la otra sede va por traslado.
--   · ordenes.traslados_almacen = { "<sede origen>": { por, en, destino, completo, nota,
--     renglones[{ sku, nombre, producto_id, cantidad, almacen_origen, almacen_destino }] } }
--     lo anota almacen_registrar_traslado_sp() después de mover el inventario
--     (salida en el origen + entrada en el destino, ref_tipo 'traslado_sp').
--
-- Todo sigue APAGADO tras config.compras.revision_almacen.
-- ============================================================

alter table public.ordenes add column if not exists sede_destino text;
alter table public.ordenes add column if not exists traslados_almacen jsonb;
comment on column public.ordenes.sede_destino is
  'SP (flujo de almacén, 30-10-2026): sede donde se necesita lo pedido. Almacén entrega primero de esa sede; lo de la otra va por traslado.';
comment on column public.ordenes.traslados_almacen is
  'SP: traslados hechos por cada sede origen hacia sede_destino: { "<sede>": { por, en, destino, completo, nota, renglones[] } }.';

-- Revisión por sede (misma función del 30-10) con el reparto empezando por la sede destino.

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
  -- Orden del reparto (30-10): primero la sede donde se NECESITA, después las otras.
  v_orden text[];
  v_traslada text;
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

  -- 3. Respondieron todas: se reparte y la SP sale de almacén. Primero entrega la sede
  --    donde se necesita (sin traslado); lo que da la otra va por traslado.
  v_orden := case when o.sede_destino = any(v_sedes)
                  then array[o.sede_destino] || array_remove(v_sedes, o.sede_destino)
                  else v_sedes end;
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
    foreach s in array v_orden loop
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
  -- Lo que entrega una sede que no es la de destino viaja por traslado.
  if o.sede_destino = any(v_sedes) then
    select string_agg(public.almacen_etiqueta_sede(x), ', ' order by ord) into v_traslada
      from unnest(v_sedes) with ordinality as u(x, ord)
      where x <> o.sede_destino and v_cuenta ? x;
    if v_traslada is not null then
      v_detalle := v_detalle || format(' · %s traslada a %s', v_traslada, public.almacen_etiqueta_sede(o.sede_destino));
    end if;
  end if;
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

-- La sede que entrega lo de OTRA sede anota su traslado en la SP. El inventario
-- ya se movió desde la pantalla (salida en el almacén de origen + entrada en el
-- almacén de la sede destino); acá queda la traza en la SP y su historial.
-- p_renglones: [{ sku, nombre, producto_id, producto_nombre, cantidad, unidad,
--                 almacen_origen, almacen_destino }, ...]
create or replace function public.almacen_registrar_traslado_sp(
  p_orden_id uuid,
  p_sede text,
  p_renglones jsonb,
  p_nota text default null
) returns public.ordenes
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.ordenes;
  v_sedes text[] := public.almacen_sedes_revision();
  v_sede text := btrim(coalesce(p_sede, ''));
  v_etq text;
  v_etq_dest text;
  v_mias text[];
  v_email text;
  v_tr jsonb;
  v_n int;
  v_otras int;
  v_mal text;
  v_completo boolean;
  v_detalle text;
begin
  if not (public.is_admin() or public.puede_modulo('inventario', 'escritura')
          or public.puede_modulo('salidas', 'escritura')) then
    raise exception 'Sin permiso para trasladar en almacén.' using errcode = '42501';
  end if;
  if not (v_sede = any(v_sedes)) then
    raise exception 'La sede «%» no atiende solicitudes de pedido.', v_sede using errcode = 'P0001';
  end if;
  v_etq := public.almacen_etiqueta_sede(v_sede);

  select email, sedes_asignadas into v_email, v_mias from public.usuarios where id = auth.uid();
  if coalesce(cardinality(v_mias), 0) > 0 and not (v_sede = any(v_mias)) then
    raise exception 'Solo puedes trasladar desde tu sede (%): no desde %.', array_to_string(v_mias, ', '), v_etq
      using errcode = '42501';
  end if;

  select * into o from public.ordenes where id = p_orden_id for update;
  if not found then
    raise exception 'Solicitud de pedido no encontrada.';
  end if;
  if o.revisada_almacen_en is null then
    raise exception 'La solicitud % todavía está en revisión de almacén.', o.codigo using errcode = 'P0001';
  end if;
  if coalesce(btrim(o.sede_destino), '') = '' then
    raise exception 'La solicitud % no indica dónde se necesita: no hay a dónde trasladar.', o.codigo using errcode = 'P0001';
  end if;
  if o.sede_destino = v_sede then
    raise exception '% es la sede que recibe la solicitud %: no traslada.', v_etq, o.codigo using errcode = 'P0001';
  end if;
  v_etq_dest := public.almacen_etiqueta_sede(o.sede_destino);

  select count(*) into v_n
    from jsonb_array_elements(coalesce(o.items, '[]'::jsonb)) it
    where coalesce(nullif(it->'almacen_origenes'->>v_sede, '')::numeric, 0) > 0;
  if v_n = 0 then
    raise exception '% no entrega nada de la solicitud %.', v_etq, o.codigo using errcode = 'P0001';
  end if;

  v_tr := case when jsonb_typeof(o.traslados_almacen) = 'object' then o.traslados_almacen else '{}'::jsonb end;
  if v_tr ? v_sede then
    raise exception '% ya registró su traslado de %.', v_etq, o.codigo using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_renglones) <> 'array' or jsonb_array_length(p_renglones) = 0 then
    raise exception 'Indica qué se trasladó.' using errcode = 'P0001';
  end if;

  -- Cada renglón trasladado: de la SP, con ficha, y no más de lo que le tocaba a esta sede.
  select string_agg(coalesce(r->>'nombre', r->>'sku'), ', ') into v_mal
    from jsonb_array_elements(p_renglones) r
    left join lateral (
      select it from jsonb_array_elements(coalesce(o.items, '[]'::jsonb)) it where it->>'sku' = r->>'sku' limit 1
    ) x on true
    where x.it is null
       or coalesce(r->>'producto_id', '') = ''
       or coalesce(nullif(r->>'cantidad', '')::numeric, 0) <= 0
       or coalesce(nullif(r->>'cantidad', '')::numeric, 0)
          > coalesce(nullif(x.it->'almacen_origenes'->>v_sede, '')::numeric, 0) + 0.0001;
  if v_mal is not null then
    raise exception 'Revisa el traslado de: % (producto o cantidad no cuadra con lo que entrega %).', v_mal, v_etq
      using errcode = 'P0001';
  end if;

  -- «Stock completo»: no falta nada (nada va a Compras) y lo da todo esta sede.
  select count(*) into v_otras
    from jsonb_array_elements(coalesce(o.items, '[]'::jsonb)) it, jsonb_each_text(
      case when jsonb_typeof(it->'almacen_origenes') = 'object' then it->'almacen_origenes' else '{}'::jsonb end) e
    where e.key <> v_sede and coalesce(nullif(e.value, '')::numeric, 0) > 0;
  v_completo := o.estado = 'atendida_almacen' and v_otras = 0;
  v_detalle := case
    when v_completo then format('%s trasladó a %s: el pedido lo tiene %s, stock completo', v_etq, v_etq_dest, v_etq)
    when o.estado = 'atendida_almacen' then format('%s trasladó a %s lo que completa el pedido', v_etq, v_etq_dest)
    else format('%s trasladó a %s lo que tiene; el resto va por Compras', v_etq, v_etq_dest)
  end;

  v_tr := v_tr || jsonb_build_object(v_sede, jsonb_build_object(
    'por', coalesce(v_email, 'almacen'),
    'en', now(),
    'destino', o.sede_destino,
    'completo', v_completo,
    'nota', nullif(btrim(coalesce(p_nota, '')), ''),
    'renglones', p_renglones
  ));

  update public.ordenes set
    traslados_almacen = v_tr,
    historial = coalesce(historial, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'at', now(), 'evento', 'traslado_almacen', 'actor', coalesce(v_email, 'almacen'),
      'sede', v_sede, 'destino', o.sede_destino, 'detalle', v_detalle))
  where id = o.id
  returning * into o;
  return o;
end $$;

revoke all on function public.almacen_registrar_traslado_sp(uuid, text, jsonb, text) from public, anon;
grant execute on function public.almacen_registrar_traslado_sp(uuid, text, jsonb, text) to authenticated;

select
  (select value from public.config where key = 'compras.revision_almacen') as interruptor,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'ordenes'
     and column_name in ('sede_destino', 'traslados_almacen')) as columnas,
  to_regprocedure('public.almacen_registrar_traslado_sp(uuid, text, jsonb, text)') is not null as funcion_traslado,
  to_regprocedure('public.almacen_revisar_solicitud(uuid, text, jsonb, boolean, text)') is not null as funcion_revision;
