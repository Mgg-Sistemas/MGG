-- ============================================================
-- MGG · Compras → Delivery · ¿quién entrega? (04-11-2026)
--
-- Pedido de la administradora: al indicar el método de pago se elige cómo llega
-- la mercancía:
--   · 'delivery'      → pagada, va a la vista de Delivery (motorizados), como hasta hoy.
--   · 'carga_pesada'  → pagada, va a CARGA PESADA: mismo flujo que Delivery, otra flota,
--                       otro rol. Quien es delivery no ve carga pesada y viceversa.
--   · 'proveedor'     → «Con entrega a domicilio»: el proveedor la trae; NO va a ninguna.
-- Una orden sin dato (las de antes) sigue siendo 'delivery'.
-- ============================================================

alter table public.ordenes add column if not exists entrega_modalidad text;
alter table public.ordenes drop constraint if exists ordenes_entrega_modalidad_chk;
alter table public.ordenes add constraint ordenes_entrega_modalidad_chk
  check (entrega_modalidad is null or entrega_modalidad in ('delivery', 'carga_pesada', 'proveedor'));
comment on column public.ordenes.entrega_modalidad is
  'Quién entrega (04-11-2026): delivery | carga_pesada | proveedor (entrega a domicilio). Null = delivery.';

-- Cada pedido y cada ubicación en vivo pertenecen a una flota.
alter table public.delivery_pedidos add column if not exists flota text not null default 'delivery';
alter table public.delivery_pedidos drop constraint if exists delivery_pedidos_flota_chk;
alter table public.delivery_pedidos add constraint delivery_pedidos_flota_chk check (flota in ('delivery', 'carga_pesada'));
alter table public.delivery_ubicaciones add column if not exists flota text not null default 'delivery';
alter table public.delivery_ubicaciones drop constraint if exists delivery_ubicaciones_flota_chk;
alter table public.delivery_ubicaciones add constraint delivery_ubicaciones_flota_chk check (flota in ('delivery', 'carga_pesada'));
create index if not exists delivery_pedidos_flota_idx on public.delivery_pedidos (flota, estado);

-- ¿Puede el usuario operar esa flota? Delivery = módulo 'delivery'; Carga pesada = módulo 'carga_pesada'.
create or replace function public.flota_puede(p_flota text, p_nivel text default 'lectura')
returns boolean language sql stable security definer set search_path to '' as $$
  select public.is_admin()
      or public.puede_modulo(case when p_flota = 'carga_pesada' then 'carga_pesada' else 'delivery' end, p_nivel)
      or public.puede_modulo(case when p_flota = 'carga_pesada' then 'carga_pesada' else 'delivery' end, 'escritura');
$$;
revoke all on function public.flota_puede(text, text) from public, anon;
grant execute on function public.flota_puede(text, text) to authenticated;

-- Las funciones compartidas (avanzar, fotos, ubicar…) sirven a las dos flotas: cada una
-- solo toca SUS pedidos (el repartidor es el dueño), así que basta con tener una de las dos.
create or replace function public.delivery_puede(p_nivel text default 'lectura')
returns boolean language sql stable security definer set search_path to '' as $$
  select public.flota_puede('delivery', p_nivel) or public.flota_puede('carga_pesada', p_nivel);
$$;

-- La flota de una orden (retiros de almacén: siempre delivery).
create or replace function public.flota_de_orden(o public.ordenes, p_tipo text default 'oc')
returns text language sql stable set search_path to '' as $$
  select case when p_tipo = 'retiro_almacen' then 'delivery'
              else coalesce(nullif(btrim(o.entrega_modalidad), ''), 'delivery') end;
$$;

-- ── Listado, por flota ──
drop function if exists public.delivery_pedidos_listado(boolean);
create or replace function public.delivery_pedidos_listado(p_incluir_cerrados boolean default false, p_flota text default 'delivery')
 RETURNS TABLE(orden_id uuid, tipo text, oc_codigo text, codigo text, total numeric, moneda text, urgente boolean, pagada_en timestamp with time zone, items jsonb, notas text, motivo text, finalidad text, almacen_destino text, proveedor_id uuid, proveedor_nombre text, proveedor_telefono text, proveedor_direccion text, proveedor_contacto text, analista_email text, analista_nombre text, analista_telefono text, pedido_id uuid, estado text, repartidor_id uuid, repartidor_nombre text, aceptado_en timestamp with time zone, en_ruta_en timestamp with time zone, entregado_en timestamp with time zone, cancelado_en timestamp with time zone, motivo_cancel text, detalle_cancel text, almacen_entrega text, nota_entrega text, fotos_recibo jsonb, fotos_entrega jsonb, historial jsonb, es_mio boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_super boolean; v_on boolean := public.delivery_conectado();
  v_alm record;
  v_flota text := case when p_flota = 'carga_pesada' then 'carga_pesada' else 'delivery' end;
begin
  if not public.flota_puede(v_flota, 'lectura') then
    raise exception 'No tienes permiso en %.', case when v_flota = 'carga_pesada' then 'Carga pesada' else 'Delivery' end using errcode = '42501';
  end if;
  v_super := public.is_admin() or public.puede_modulo(case when v_flota = 'carga_pesada' then 'carga_pesada' else 'delivery' end, 'full');
  select u.email, public.delivery_nombre_usuario(u.email) as nombre, u.telefono into v_alm
    from public.usuarios u
   where u.estado = 'activo' and u.role = 'almacenista' and 'LOS PINOS' = any(coalesce(u.sedes_asignadas, '{}'::text[]))
   order by u.email limit 1;
  return query
  with vivos as (
    select distinct on (d.orden_id, d.tipo) d.* from public.delivery_pedidos d
    order by d.orden_id, d.tipo, (d.estado <> 'cancelado') desc, d.created_at desc
  )
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
      (v_on and o.estado = 'pagada' and o.recibida_en is null and o.pagada_en >= timestamptz '2026-11-03 00:00:00-04'
        and public.flota_de_orden(o) = v_flota
        and (v.id is null or v.estado = 'cancelado'))
      or (v.id is not null and v.flota = v_flota and v.estado in ('aceptado', 'en_ruta') and o.recibida_en is null and (v.repartidor_id = v_uid or v_super))
      or (p_incluir_cerrados and v.id is not null and v.flota = v_flota and v.estado in ('entregado', 'cancelado') and (v.repartidor_id = v_uid or v_super))
    )
  union all
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
  where v_flota = 'delivery'
    and (
      (v_on and public.delivery_retiro_disponible(o) and (v.id is null or v.estado = 'cancelado'))
      or (v.id is not null and v.estado in ('aceptado', 'en_ruta') and (v.repartidor_id = v_uid or v_super))
      or (p_incluir_cerrados and v.id is not null and v.estado in ('entregado', 'cancelado') and (v.repartidor_id = v_uid or v_super))
    )
  order by 7 desc, 8 asc nulls last;
end $function$;
revoke all on function public.delivery_pedidos_listado(boolean, text) from public, anon;
grant execute on function public.delivery_pedidos_listado(boolean, text) to authenticated;

-- ── Tomar: la flota sale de la orden; cada quien toma solo lo de la suya ──
create or replace function public.delivery_tomar(p_orden_id uuid, p_tipo text default 'oc')
 RETURNS delivery_pedidos
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_o public.ordenes; v_ya public.delivery_pedidos; v_fila public.delivery_pedidos; v_email text; v_nombre text;
  v_tipo text := coalesce(nullif(btrim(p_tipo), ''), 'oc'); v_flota text;
begin
  if not public.delivery_conectado() then
    raise exception 'Delivery todavía no está conectado a Compras.' using errcode = 'P0001';
  end if;
  if v_tipo not in ('oc', 'retiro_almacen') then raise exception 'Tipo de pedido inválido.' using errcode = '23514'; end if;
  select * into v_o from public.ordenes where id = p_orden_id for update;
  if v_o.id is null then raise exception 'No se encontró la orden.' using errcode = '23503'; end if;
  v_flota := public.flota_de_orden(v_o, v_tipo);
  if v_flota = 'proveedor' then
    raise exception 'La orden % la entrega el proveedor (entrega a domicilio): no va por delivery.', coalesce(v_o.oc_codigo, v_o.codigo) using errcode = 'P0001';
  end if;
  if not public.flota_puede(v_flota, 'escritura') then
    raise exception 'Esta orden es de %: no la puedes tomar.', case when v_flota = 'carga_pesada' then 'Carga pesada' else 'Delivery' end using errcode = '42501';
  end if;
  if v_tipo = 'oc' and (v_o.estado <> 'pagada' or v_o.recibida_en is not null or coalesce(v_o.pagada_en, '-infinity') < timestamptz '2026-11-03 00:00:00-04') then
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
  insert into public.delivery_pedidos (orden_id, tipo, flota, estado, en_ruta_en, repartidor_id, repartidor_email, repartidor_nombre, historial)
  values (p_orden_id, v_tipo, v_flota, 'en_ruta', now(), auth.uid(), v_email, v_nombre,
    jsonb_build_array(jsonb_build_object('at', now(), 'evento', 'aceptado', 'actor', v_email, 'tipo', v_tipo, 'flota', v_flota),
                      jsonb_build_object('at', now(), 'evento', 'en_ruta', 'actor', v_email)))
  returning * into v_fila;
  return v_fila;
exception when unique_violation then
  raise exception 'Este pedido ya lo tomó otro delivery.' using errcode = 'P0001';
end $function$;

-- ── «No disponible»: igual, en su flota ──
create or replace function public.delivery_no_disponible(p_orden_id uuid, p_tipo text default 'oc', p_motivo text default null, p_detalle text default null)
 RETURNS delivery_pedidos
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_o public.ordenes; v_ya public.delivery_pedidos; v_fila public.delivery_pedidos; v_email text;
  v_tipo text := coalesce(nullif(btrim(p_tipo), ''), 'oc'); v_flota text;
begin
  if v_tipo not in ('oc', 'retiro_almacen') then raise exception 'Tipo de pedido inválido.' using errcode = '23514'; end if;
  if char_length(btrim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Indica el motivo por el que no está disponible.' using errcode = '23514';
  end if;
  select * into v_o from public.ordenes where id = p_orden_id;
  if v_o.id is null then raise exception 'No se encontró la orden.' using errcode = '23503'; end if;
  v_flota := public.flota_de_orden(v_o, v_tipo);
  if v_flota = 'proveedor' or not public.flota_puede(v_flota, 'escritura') then
    raise exception 'No tienes permiso de escritura en esta flota.' using errcode = '42501';
  end if;
  select * into v_ya from public.delivery_pedidos where orden_id = p_orden_id and tipo = v_tipo and estado <> 'cancelado' limit 1;
  if v_ya.id is not null then
    raise exception 'Este pedido ya lo tomó %.', coalesce(v_ya.repartidor_nombre, v_ya.repartidor_email, 'otro delivery') using errcode = 'P0001';
  end if;
  select email into v_email from public.usuarios where id = auth.uid();
  insert into public.delivery_pedidos (orden_id, tipo, flota, estado, repartidor_id, repartidor_email, repartidor_nombre,
    cancelado_en, motivo_cancel, detalle_cancel, historial)
  values (p_orden_id, v_tipo, v_flota, 'cancelado', auth.uid(), v_email, public.delivery_nombre_usuario(v_email),
    now(), btrim(p_motivo), nullif(btrim(coalesce(p_detalle, '')), ''),
    jsonb_build_array(jsonb_build_object('at', now(), 'evento', 'no_disponible', 'actor', v_email, 'motivo', btrim(p_motivo))))
  returning * into v_fila;
  return v_fila;
end $function$;

-- ── Ubicación en vivo: con su flota (el mapa de cada una ve solo la suya) ──
drop function if exists public.delivery_ubicar(double precision, double precision, double precision, double precision, double precision, uuid);
create or replace function public.delivery_ubicar(p_lat double precision, p_lng double precision, p_precision double precision default null,
  p_velocidad double precision default null, p_rumbo double precision default null, p_pedido_id uuid default null, p_flota text default 'delivery')
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_email text; v_flota text := case when p_flota = 'carga_pesada' then 'carga_pesada' else 'delivery' end;
begin
  if not public.flota_puede(v_flota, 'escritura') then
    raise exception 'No tienes permiso de escritura en Delivery.' using errcode = '42501';
  end if;
  if p_lat is null or p_lng is null or abs(p_lat) > 90 or abs(p_lng) > 180 then
    raise exception 'Ubicación inválida.' using errcode = '23514';
  end if;
  select email into v_email from public.usuarios where id = auth.uid();
  insert into public.delivery_ubicaciones (repartidor_id, repartidor_email, repartidor_nombre, lat, lng, precision_m, velocidad, rumbo, pedido_id, flota, actualizado_en)
  values (auth.uid(), v_email, public.delivery_nombre_usuario(v_email), p_lat, p_lng, p_precision, p_velocidad, p_rumbo, p_pedido_id, v_flota, now())
  on conflict (repartidor_id) do update set
    lat = excluded.lat, lng = excluded.lng, precision_m = excluded.precision_m, velocidad = excluded.velocidad,
    rumbo = excluded.rumbo, pedido_id = excluded.pedido_id, repartidor_nombre = excluded.repartidor_nombre,
    repartidor_email = excluded.repartidor_email, flota = excluded.flota, actualizado_en = now();
end $function$;
revoke all on function public.delivery_ubicar(double precision, double precision, double precision, double precision, double precision, uuid, text) from public, anon;
grant execute on function public.delivery_ubicar(double precision, double precision, double precision, double precision, double precision, uuid, text) to authenticated;

-- ── Rol «Carga pesada»: solo su pantalla de teléfono, como el de Delivery ──
insert into public.custom_roles (key, label, descripcion, color, sistema, created_by, solo_telefono)
values ('carga_pesada', 'CARGA PESADA', 'Toma y entrega los pedidos de carga pesada desde el teléfono (como Delivery, otra flota). No ve los de Delivery.', '#b45309', false, 'mineralgroupguayanaca@gmail.com', true)
on conflict (key) do nothing;
insert into public.roles_permisos (role, permisos, vistas_telefono, updated_at, updated_by)
select 'carga_pesada',
       (select jsonb_object_agg(k, case when k = 'carga_pesada' then '{"full":false,"lectura":true,"escritura":true}'::jsonb
                                        when k in ('dashboard') then '{"full":false,"lectura":true,"escritura":false}'::jsonb
                                        when k in ('ajustes') then v
                                        else '{"full":false,"lectura":false,"escritura":false}'::jsonb end)
          from (select * from jsonb_each(rp.permisos) union all select 'carga_pesada', '{}'::jsonb where not rp.permisos ? 'carga_pesada') e(k, v)),
       '["carga_pesada"]'::jsonb, now(), 'mineralgroupguayanaca@gmail.com'
  from public.roles_permisos rp where rp.role = 'delivery'
on conflict (role) do nothing;
