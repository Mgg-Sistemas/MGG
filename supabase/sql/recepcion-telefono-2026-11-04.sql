-- ============================================================
-- MGG · Inventario · recepción desde el teléfono de almacén (04-11-2026)
--
-- Pedido de la administradora: el almacenista RECEPCIONA en su teléfono lo que
-- entrega el delivery (o lo que llegue) y eso suma al inventario de su almacén,
-- marca la orden recibida en Compras y genera su WhatsApp con foto y su PDF.
-- Las fotos de la recepción quedan en la orden (en el bucket de la OC).
-- Idempotente.
-- ============================================================
alter table public.ordenes add column if not exists recepcion_fotos jsonb;
comment on column public.ordenes.recepcion_fotos is
  'Fotos tomadas al recepcionar (04-11-2026): [{path, filename}] en el bucket de la OC.';
select count(*) as con_fotos from public.ordenes where recepcion_fotos is not null;

-- Las notificaciones dirigidas a UNA persona (destino = su id) se ven y se marcan
-- leídas. Antes la regla solo dejaba las de 'all' y las del rol: el aviso al
-- almacenista «tienes una recepción pendiente» no le llegaba.
drop policy if exists "notif read role" on public.notificaciones;
create policy "notif read role" on public.notificaciones for select to authenticated
  using ((destino = 'all') or (destino = (select (auth.uid())::text))
         or (destino = (select u.role from public.usuarios u where u.id = (select auth.uid()))));
drop policy if exists "notif update auth" on public.notificaciones;
create policy "notif update auth" on public.notificaciones for update to authenticated
  using ((destino = 'all') or (destino = (select (auth.uid())::text))
         or (destino = (select u.role from public.usuarios u where u.id = (select auth.uid()))));

-- Qué delivery trae (o trajo) cada orden, para la pantalla de recepciones del
-- almacenista, que no tiene permiso de Delivery ni de Compras.
create or replace function public.inv_tel_delivery_de_ordenes(p_ids uuid[])
returns table (orden_id uuid, estado text, repartidor_nombre text, almacen_entrega text, entregado_en timestamptz, aceptado_en timestamptz, fotos_entrega jsonb)
language sql stable security definer set search_path = '' as $$
  select distinct on (d.orden_id) d.orden_id, d.estado, d.repartidor_nombre, d.almacen_entrega, d.entregado_en, d.aceptado_en, d.fotos_entrega
    from public.delivery_pedidos d
   where d.orden_id = any(p_ids) and coalesce(d.tipo, 'oc') = 'oc' and d.estado in ('aceptado', 'en_ruta', 'entregado')
     and public.is_operativo()
   order by d.orden_id, d.created_at desc;
$$;
revoke all on function public.inv_tel_delivery_de_ordenes(uuid[]) from public, anon;
grant execute on function public.inv_tel_delivery_de_ordenes(uuid[]) to authenticated;

select (select count(*) from pg_policies where tablename = 'notificaciones' and qual like '%auth.uid())::text%') as notif_por_persona,
       (select count(*) from pg_proc where proname = 'inv_tel_delivery_de_ordenes') as fn;
