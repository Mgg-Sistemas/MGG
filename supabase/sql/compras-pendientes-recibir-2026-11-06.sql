-- ============================================================
-- MGG · Compras · «Pendientes por recibir» (06-11-2026)
-- Pedido de la administradora: una OC pagada ya NO va directo al delivery. Primero cae en
-- la tarjeta «Pendientes por recibir» del tablero de Compras; ahí el analista confirma el
-- retiro y cómo llega (Delivery, Carga pesada o Con entrega a domicilio). Recién entonces
-- la ve la flota que toca.
--   · ordenes.retiro_confirmado_en / retiro_confirmado_por: cuándo y quién confirmó.
--   · delivery_pedidos_listado y delivery_tomar exigen el retiro confirmado.
--   · Las OC que el delivery ya tomó quedan confirmadas (no vuelven atrás).
--   · Trazabilidad: cada vez que el delivery / carga pesada toma, entrega o dice «no
--     disponible», queda un evento en ordenes.historial con la flota y la persona.
-- ============================================================
begin;

alter table public.ordenes add column if not exists retiro_confirmado_en timestamptz;
alter table public.ordenes add column if not exists retiro_confirmado_por text;
comment on column public.ordenes.retiro_confirmado_en is
  '06-11-2026: cuándo Compras confirmó el retiro de la OC pagada (y quién entrega). Sin dato = «Pendientes por recibir»; el delivery no la ve.';

-- Las que el delivery ya tomó (aunque luego dijera «no disponible») quedan confirmadas.
update public.ordenes o
   set retiro_confirmado_en = d.primero, retiro_confirmado_por = 'sistema (ya la había tomado el delivery)'
  from (select orden_id, min(coalesce(aceptado_en, created_at)) as primero
          from public.delivery_pedidos where tipo = 'oc' group by orden_id) d
 where d.orden_id = o.id and o.retiro_confirmado_en is null;

CREATE OR REPLACE FUNCTION public.delivery_pedidos_listado(p_incluir_cerrados boolean DEFAULT false, p_flota text DEFAULT 'delivery'::text)
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
        and o.retiro_confirmado_en is not null
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

CREATE OR REPLACE FUNCTION public.delivery_tomar(p_orden_id uuid, p_tipo text DEFAULT 'oc'::text)
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
  if v_tipo = 'oc' and v_o.retiro_confirmado_en is null then
    raise exception 'La orden % todavía no la confirma Compras para retiro.', coalesce(v_o.oc_codigo, v_o.codigo) using errcode = 'P0001';
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

-- Trazabilidad de la OC: quién la tomó (y de qué flota), cuándo la entregó o por qué no.
create or replace function public.delivery_a_historial_oc()
returns trigger language plpgsql security definer set search_path to '' as $$
declare v_flota text; v_ev text; v_mot text; v_at timestamptz;
begin
  if new.tipo <> 'oc' then return new; end if;
  v_flota := case when new.flota = 'carga_pesada' then 'Carga pesada' else 'Delivery' end;
  if tg_op = 'INSERT' then
    v_ev := 'delivery_tomado'; v_at := coalesce(new.aceptado_en, now());
    v_mot := v_flota || ' · ' || coalesce(new.repartidor_nombre, new.repartidor_email, '—');
  elsif new.estado is distinct from old.estado and new.estado = 'entregado' then
    v_ev := 'delivery_entregado'; v_at := coalesce(new.entregado_en, now());
    v_mot := v_flota || ' · ' || coalesce(new.repartidor_nombre, new.repartidor_email, '—')
      || coalesce(' · en ' || nullif(btrim(new.almacen_entrega), ''), '');
  elsif new.estado is distinct from old.estado and new.estado = 'cancelado' then
    v_ev := 'delivery_no_disponible'; v_at := coalesce(new.cancelado_en, now());
    v_mot := v_flota || ' · ' || coalesce(new.repartidor_nombre, new.repartidor_email, '—')
      || coalesce(' · ' || nullif(btrim(new.motivo_cancel), ''), '');
  else
    return new;
  end if;
  update public.ordenes
     set historial = coalesce(historial, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
           'at', v_at, 'evento', v_ev, 'actor', coalesce(new.repartidor_email, ''), 'motivo', v_mot,
           'flota', new.flota, 'repartidor', new.repartidor_nombre))
   where id = new.orden_id;
  return new;
end $$;
revoke all on function public.delivery_a_historial_oc() from public, anon;

drop trigger if exists trg_delivery_a_historial_oc on public.delivery_pedidos;
create trigger trg_delivery_a_historial_oc
  after insert or update of estado on public.delivery_pedidos
  for each row execute function public.delivery_a_historial_oc();

-- Lo que ya pasó (antes del trigger): se agrega a la trazabilidad, en orden de fecha.
with ev as (
  select d.orden_id, jsonb_build_object('at', coalesce(d.aceptado_en, d.created_at), 'evento', 'delivery_tomado',
           'actor', coalesce(d.repartidor_email, ''), 'flota', d.flota, 'repartidor', d.repartidor_nombre,
           'motivo', case when d.flota = 'carga_pesada' then 'Carga pesada' else 'Delivery' end || ' · ' || coalesce(d.repartidor_nombre, d.repartidor_email, '—')) as e
    from public.delivery_pedidos d where d.tipo = 'oc'
  union all
  select d.orden_id, jsonb_build_object('at', d.entregado_en, 'evento', 'delivery_entregado',
           'actor', coalesce(d.repartidor_email, ''), 'flota', d.flota, 'repartidor', d.repartidor_nombre,
           'motivo', case when d.flota = 'carga_pesada' then 'Carga pesada' else 'Delivery' end || ' · ' || coalesce(d.repartidor_nombre, d.repartidor_email, '—')
             || coalesce(' · en ' || nullif(btrim(d.almacen_entrega), ''), ''))
    from public.delivery_pedidos d where d.tipo = 'oc' and d.estado = 'entregado' and d.entregado_en is not null
  union all
  select d.orden_id, jsonb_build_object('at', d.cancelado_en, 'evento', 'delivery_no_disponible',
           'actor', coalesce(d.repartidor_email, ''), 'flota', d.flota, 'repartidor', d.repartidor_nombre,
           'motivo', case when d.flota = 'carga_pesada' then 'Carga pesada' else 'Delivery' end || ' · ' || coalesce(d.repartidor_nombre, d.repartidor_email, '—')
             || coalesce(' · ' || nullif(btrim(d.motivo_cancel), ''), ''))
    from public.delivery_pedidos d where d.tipo = 'oc' and d.estado = 'cancelado' and d.cancelado_en is not null
), nuevos as (
  select orden_id, jsonb_agg(e) as es from ev group by orden_id
)
update public.ordenes o
   set historial = (select jsonb_agg(x order by (x->>'at')::timestamptz)
                      from jsonb_array_elements(coalesce(o.historial, '[]'::jsonb) || n.es) x)
  from nuevos n
 where n.orden_id = o.id
   and not exists (select 1 from jsonb_array_elements(coalesce(o.historial, '[]'::jsonb)) h where h->>'evento' like 'delivery_%');

commit;
