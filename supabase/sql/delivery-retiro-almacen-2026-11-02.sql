-- ============================================================
-- MGG · Delivery · retiro en el almacén de Los Pinos (02-11-2026)
--
-- Regla de la administradora: cuando la revisión de una Solicitud de Pedido
-- deja que LOS PINOS entrega algo (ordenes.items[].almacen_origenes['LOS PINOS'] > 0),
-- a Delivery le llega un pedido para BUSCAR esos materiales en Los Pinos y
-- llevarlos a donde se necesitan (sede_destino). Es aparte de la OC: la misma
-- orden puede tener su retiro (tipo 'retiro_almacen') y, si Compras compra el
-- resto, su OC pagada (tipo 'oc'), cada uno con su toma.
-- Solo SP revisadas desde el 02-11-2026 (lo anterior ya se movió a mano).
-- Igual que la OC: aparece solo con Delivery conectado (config compras.delivery).
-- ============================================================

alter table public.delivery_pedidos add column if not exists tipo text not null default 'oc';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'delivery_pedidos_tipo_check') then
    alter table public.delivery_pedidos add constraint delivery_pedidos_tipo_check check (tipo in ('oc', 'retiro_almacen'));
  end if;
end $$;
-- UNA toma viva por orden Y por tipo (el retiro y la OC de la misma orden van aparte).
drop index if exists public.delivery_pedidos_una_viva;
create unique index if not exists delivery_pedidos_una_viva_tipo on public.delivery_pedidos (orden_id, tipo) where estado <> 'cancelado';

-- Lo que entrega Los Pinos de cada renglón (nombre, cantidad, unidad). Vacío = nada.
create or replace function public.delivery_items_retiro(p_items jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'nombre', it->>'nombre',
           'cantidad', (it->'almacen_origenes'->>'LOS PINOS')::numeric,
           'unidad', it->>'unidad')), '[]'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) it
  where jsonb_typeof(it->'almacen_origenes') = 'object'
    and coalesce(it->'almacen_origenes'->>'LOS PINOS', '') ~ '^[0-9]+(\.[0-9]+)?$'
    and (it->'almacen_origenes'->>'LOS PINOS')::numeric > 0;
$$;
revoke all on function public.delivery_items_retiro(jsonb) from public, anon;
grant execute on function public.delivery_items_retiro(jsonb) to authenticated;

-- ¿La orden tiene un retiro en Los Pinos que Delivery puede tomar?
create or replace function public.delivery_retiro_disponible(o public.ordenes) returns boolean
language sql stable set search_path = '' as $$
  select o.revisada_almacen_en is not null
     and o.revisada_almacen_en >= timestamptz '2026-11-02 00:00:00-04'
     and o.estado not in ('anulada', 'cancelada', 'rechazada', 'desistida_proveedor')
     and jsonb_array_length(public.delivery_items_retiro(o.items)) > 0;
$$;
revoke all on function public.delivery_retiro_disponible(public.ordenes) from public, anon;
grant execute on function public.delivery_retiro_disponible(public.ordenes) to authenticated;

-- El listado ahora lleva `tipo` (cambia el tipo de retorno: se recrea).
drop function if exists public.delivery_pedidos_listado(boolean);
create function public.delivery_pedidos_listado(p_incluir_cerrados boolean default false)
returns table (
  orden_id uuid, tipo text, oc_codigo text, codigo text, total numeric, moneda text, urgente boolean, pagada_en timestamptz,
  items jsonb, notas text, motivo text, finalidad text, almacen_destino text,
  proveedor_id uuid, proveedor_nombre text, proveedor_telefono text, proveedor_direccion text, proveedor_contacto text,
  analista_email text, analista_nombre text, analista_telefono text,
  pedido_id uuid, estado text, repartidor_id uuid, repartidor_nombre text, aceptado_en timestamptz, en_ruta_en timestamptz,
  entregado_en timestamptz, cancelado_en timestamptz, motivo_cancel text, detalle_cancel text, almacen_entrega text,
  nota_entrega text, fotos_recibo jsonb, fotos_entrega jsonb, historial jsonb, es_mio boolean
)
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_super boolean; v_on boolean := public.delivery_conectado();
  v_alm record;
begin
  if not public.delivery_puede('lectura') then
    raise exception 'No tienes permiso en Delivery.' using errcode = '42501';
  end if;
  v_super := public.is_admin() or public.puede_modulo('delivery', 'full');
  -- A quién llamar en Los Pinos: el almacenista activo con esa sede.
  select u.email, public.delivery_nombre_usuario(u.email) as nombre, u.telefono into v_alm
    from public.usuarios u
   where u.estado = 'activo' and u.role = 'almacenista' and 'LOS PINOS' = any(coalesce(u.sedes_asignadas, '{}'::text[]))
   order by u.email limit 1;
  return query
  with vivos as (
    select distinct on (d.orden_id, d.tipo) d.* from public.delivery_pedidos d
    order by d.orden_id, d.tipo, (d.estado <> 'cancelado') desc, d.created_at desc
  )
  -- OC pagadas: buscar al proveedor
  select o.id, 'oc'::text, o.oc_codigo, o.codigo, o.total, coalesce(o.moneda, 'USD'), coalesce(o.urgente, false), o.pagada_en,
         o.items, o.notas, o.motivo, o.finalidad, o.almacen_destino,
         p.id, p.razon_social, p.telefono, p.direccion, p.contacto,
         coalesce(o.oc_creada_por, o.aprobada_por),
         public.delivery_nombre_usuario(coalesce(o.oc_creada_por, o.aprobada_por)),
         (select u.telefono from public.usuarios u where lower(u.email) = lower(coalesce(o.oc_creada_por, o.aprobada_por)) limit 1),
         v.id, coalesce(v.estado, 'por_tomar'), v.repartidor_id, v.repartidor_nombre, v.aceptado_en, v.en_ruta_en,
         v.entregado_en, v.cancelado_en, v.motivo_cancel, v.detalle_cancel, v.almacen_entrega, v.nota_entrega,
         coalesce(v.fotos_recibo, '[]'::jsonb), coalesce(v.fotos_entrega, '[]'::jsonb), coalesce(v.historial, '[]'::jsonb),
         (v.repartidor_id = v_uid)
  from public.ordenes o
  left join public.proveedores p on p.id = o.proveedor_id
  left join vivos v on v.orden_id = o.id and v.tipo = 'oc'
  where coalesce(o.clase, 'producto') <> 'servicio'
    and o.oc_codigo is not null
    and (
      (v_on and o.estado = 'pagada' and o.recibida_en is null and (v.id is null or v.estado = 'cancelado'))
      or (v.id is not null and v.estado in ('aceptado', 'en_ruta') and (v.repartidor_id = v_uid or v_super or public.delivery_puede('lectura')))
      or (p_incluir_cerrados and v.id is not null and v.estado in ('entregado', 'cancelado'))
    )
  union all
  -- SP con existencias en Los Pinos: buscar en el almacén y llevar a donde se necesita
  select o.id, 'retiro_almacen'::text, null::text, o.codigo, 0::numeric, 'USD'::text, coalesce(o.urgente, false), o.revisada_almacen_en,
         public.delivery_items_retiro(o.items), o.notas, o.motivo, o.finalidad,
         coalesce(nullif(btrim(o.sede_destino), ''), o.almacen_destino),
         null::uuid, 'ALMACÉN LOS PINOS'::text, v_alm.telefono, null::text, v_alm.nombre,
         o.solicitante_email,
         coalesce(nullif(btrim(o.solicitante_persona), ''), public.delivery_nombre_usuario(o.solicitante_email), o.solicitante),
         (select u.telefono from public.usuarios u where lower(u.email) = lower(o.solicitante_email) limit 1),
         v.id, coalesce(v.estado, 'por_tomar'), v.repartidor_id, v.repartidor_nombre, v.aceptado_en, v.en_ruta_en,
         v.entregado_en, v.cancelado_en, v.motivo_cancel, v.detalle_cancel, v.almacen_entrega, v.nota_entrega,
         coalesce(v.fotos_recibo, '[]'::jsonb), coalesce(v.fotos_entrega, '[]'::jsonb), coalesce(v.historial, '[]'::jsonb),
         (v.repartidor_id = v_uid)
  from public.ordenes o
  left join vivos v on v.orden_id = o.id and v.tipo = 'retiro_almacen'
  where (
      (v_on and public.delivery_retiro_disponible(o) and (v.id is null or v.estado = 'cancelado'))
      or (v.id is not null and v.estado in ('aceptado', 'en_ruta') and (v.repartidor_id = v_uid or v_super or public.delivery_puede('lectura')))
      or (p_incluir_cerrados and v.id is not null and v.estado in ('entregado', 'cancelado'))
    )
  order by 7 desc, 8 asc nulls last;
end $$;
revoke all on function public.delivery_pedidos_listado(boolean) from public, anon;
grant execute on function public.delivery_pedidos_listado(boolean) to authenticated;

-- Tomar: ahora con el tipo ('oc' por defecto, como antes).
drop function if exists public.delivery_tomar(uuid);
create or replace function public.delivery_tomar(p_orden_id uuid, p_tipo text default 'oc') returns public.delivery_pedidos
language plpgsql security definer set search_path = '' as $$
declare v_o public.ordenes; v_ya public.delivery_pedidos; v_fila public.delivery_pedidos; v_email text; v_nombre text;
  v_tipo text := coalesce(nullif(btrim(p_tipo), ''), 'oc');
begin
  if not public.delivery_puede('escritura') then
    raise exception 'No tienes permiso de escritura en Delivery.' using errcode = '42501';
  end if;
  if not public.delivery_conectado() then
    raise exception 'Delivery todavía no está conectado a Compras.' using errcode = 'P0001';
  end if;
  if v_tipo not in ('oc', 'retiro_almacen') then raise exception 'Tipo de pedido inválido.' using errcode = '23514'; end if;
  select * into v_o from public.ordenes where id = p_orden_id for update;
  if v_o.id is null then raise exception 'No se encontró la orden.' using errcode = '23503'; end if;
  if v_tipo = 'oc' and (v_o.estado <> 'pagada' or v_o.recibida_en is not null) then
    raise exception 'La orden % ya no está disponible para delivery (estado: %).', coalesce(v_o.oc_codigo, v_o.codigo), v_o.estado using errcode = 'P0001';
  end if;
  if v_tipo = 'retiro_almacen' and not public.delivery_retiro_disponible(v_o) then
    raise exception 'La solicitud % ya no tiene retiro en Los Pinos (estado: %).', v_o.codigo, v_o.estado using errcode = 'P0001';
  end if;
  select * into v_ya from public.delivery_pedidos where orden_id = p_orden_id and tipo = v_tipo and estado <> 'cancelado' limit 1;
  if v_ya.id is not null then
    raise exception 'Este pedido ya lo tomó %.', coalesce(v_ya.repartidor_nombre, v_ya.repartidor_email, 'otro delivery') using errcode = 'P0001';
  end if;
  select email into v_email from public.usuarios where id = auth.uid();
  v_nombre := public.delivery_nombre_usuario(v_email);
  insert into public.delivery_pedidos (orden_id, tipo, repartidor_id, repartidor_email, repartidor_nombre, historial)
  values (p_orden_id, v_tipo, auth.uid(), v_email, v_nombre,
    jsonb_build_array(jsonb_build_object('at', now(), 'evento', 'aceptado', 'actor', v_email,
      'tipo', v_tipo)))
  returning * into v_fila;
  return v_fila;
exception when unique_violation then
  raise exception 'Este pedido ya lo tomó otro delivery.' using errcode = 'P0001';
end $$;
revoke all on function public.delivery_tomar(uuid, text) from public, anon;
grant execute on function public.delivery_tomar(uuid, text) to authenticated;

select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'delivery_pedidos' and column_name = 'tipo') as col_tipo,
  (select count(*) from pg_indexes where indexname = 'delivery_pedidos_una_viva_tipo') as indice,
  (select count(*) from pg_proc where proname = 'delivery_tomar') as tomar,
  (select count(*) from public.ordenes o where public.delivery_retiro_disponible(o)) as retiros_hoy;
