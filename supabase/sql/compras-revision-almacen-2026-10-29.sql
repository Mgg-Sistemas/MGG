-- ============================================================
-- MGG · Compras · Revisión de ALMACÉN antes de Compras (29-10-2026)
--
-- Flujo nuevo de la Solicitud de Pedido (SP):
--   1. La SP nace en `revision_almacen` (no en `pendiente`).
--   2. Almacén revisa renglón por renglón (o por lote) qué tiene y cuánto.
--   3. Al marcarla revisada, cada renglón queda con:
--        cantidad_solicitada = lo que se pidió
--        cantidad_almacen    = lo que almacén tiene
--        cantidad            = lo que falta (lo que Compras cotiza)
--      y la SP pasa a `pendiente` (Compras la acepta y cotiza) o, si almacén
--      lo tiene todo, a `atendida_almacen` (no llega a Compras).
--
-- Arranca APAGADO: el interruptor `compras.revision_almacen` en `config`
-- queda en {"activo": false} y el flujo de siempre sigue igual hasta que la
-- administradora diga que se active (se pasa a true y listo).
-- ============================================================

-- Los dos estados nuevos de la SP (la columna `estado` es el enum estado_orden).
alter type public.estado_orden add value if not exists 'revision_almacen';
alter type public.estado_orden add value if not exists 'atendida_almacen';

insert into public.config (key, value, updated_by, updated_at)
values ('compras.revision_almacen', '{"activo": false}'::jsonb, 'sistema', now())
on conflict (key) do nothing;

alter table public.ordenes add column if not exists revisada_almacen_por text;
alter table public.ordenes add column if not exists revisada_almacen_en timestamptz;
alter table public.ordenes add column if not exists nota_almacen text;

-- Guarda lo que almacén va marcando y, con p_finalizar, cierra la revisión.
-- p_items: [{ "sku": "...", "disponible": 3, "revisado": true }, ...]
-- Lo hace la base (security definer) para que nadie salte el estado: solo
-- una SP en `revision_almacen` se toca, y solo quien escribe en Inventario.
create or replace function public.almacen_revisar_solicitud(
  p_orden_id uuid,
  p_items jsonb,
  p_finalizar boolean default false,
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
  v_items jsonb := '[]'::jsonb;
  v_sol numeric;
  v_disp numeric;
  v_falta numeric;
  v_compra boolean;
  v_hay_compra boolean := false;
  v_email text;
  v_estado public.estado_orden;
  v_total numeric := 0;
  v_ahora timestamptz := now();
begin
  if not (public.is_admin() or public.puede_modulo('inventario', 'escritura')) then
    raise exception 'Sin permiso para revisar solicitudes de pedido en almacén.' using errcode = '42501';
  end if;

  select * into o from public.ordenes where id = p_orden_id for update;
  if not found then
    raise exception 'Solicitud de pedido no encontrada.';
  end if;
  if o.estado <> 'revision_almacen' then
    raise exception 'La solicitud % ya no está en revisión de almacén (estado: %).', o.codigo, o.estado
      using errcode = 'P0001';
  end if;

  select email into v_email from public.usuarios where id = auth.uid();

  for it in select value from jsonb_array_elements(coalesce(o.items, '[]'::jsonb)) loop
    -- Lo que la SP ya trae desmarcado (comprar = false) no se pide: queda igual.
    if not coalesce((it->>'comprar')::boolean, true) then
      v_items := v_items || jsonb_build_array(it);
      continue;
    end if;
    r := null;
    select x into r from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
      where x->>'sku' = it->>'sku' limit 1;

    v_sol := coalesce(nullif(it->>'cantidad_solicitada', '')::numeric, nullif(it->>'cantidad', '')::numeric, 0);
    if r is not null then
      v_disp := least(greatest(coalesce(nullif(r->>'disponible', '')::numeric, 0), 0), v_sol);
      it := it || jsonb_build_object(
        'cantidad_almacen', v_disp,
        'almacen_revisado', coalesce((r->>'revisado')::boolean, true)
      );
    else
      v_disp := least(greatest(coalesce(nullif(it->>'cantidad_almacen', '')::numeric, 0), 0), v_sol);
    end if;

    if p_finalizar then
      v_falta := greatest(v_sol - v_disp, 0);
      v_compra := v_falta > 0 and coalesce((it->>'comprar')::boolean, true);
      if v_compra then v_hay_compra := true; end if;
      it := it || jsonb_build_object(
        'cantidad_solicitada', v_sol,
        'cantidad_almacen', v_disp,
        'almacen_revisado', true,
        'cantidad', v_falta,
        'comprar', v_compra
      );
      v_total := v_total + v_falta * coalesce(nullif(it->>'precio', '')::numeric, 0);
    end if;

    v_items := v_items || jsonb_build_array(it);
  end loop;

  if not p_finalizar then
    update public.ordenes set items = v_items where id = o.id returning * into o;
    return o;
  end if;

  v_estado := (case when v_hay_compra then 'pendiente' else 'atendida_almacen' end)::public.estado_orden;
  update public.ordenes set
    items = v_items,
    total = v_total,
    estado = v_estado,
    revisada_almacen_por = coalesce(v_email, 'almacen'),
    revisada_almacen_en = v_ahora,
    nota_almacen = nullif(btrim(coalesce(p_nota, '')), ''),
    historial = coalesce(historial, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'at', v_ahora,
      'evento', 'revisada_almacen',
      'actor', coalesce(v_email, 'almacen'),
      'detalle', case when v_hay_compra then 'Pasa a Compras con lo que falta'
                      else 'Almacén tiene todo: no pasa a Compras' end
    ))
  where id = o.id
  returning * into o;
  return o;
end $$;

revoke all on function public.almacen_revisar_solicitud(uuid, jsonb, boolean, text) from public, anon;
grant execute on function public.almacen_revisar_solicitud(uuid, jsonb, boolean, text) to authenticated;

select
  (select value from public.config where key = 'compras.revision_almacen') as interruptor,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'ordenes'
     and column_name in ('revisada_almacen_por', 'revisada_almacen_en', 'nota_almacen')) as columnas,
  to_regprocedure('public.almacen_revisar_solicitud(uuid, jsonb, boolean, text)') is not null as funcion;
