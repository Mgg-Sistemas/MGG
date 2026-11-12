-- ============================================================
-- MGG · A Compras solo le llega la FACTURA del delivery (12-11-2026)
--
-- La administradora: en el teléfono del delivery las fotos van por segmentos
-- «🧾 Cargar factura» y «📷 Cargar foto del producto»; «a Compras solo le
-- llegará la foto de la factura». La copia en la orden (ordenes.facturas_delivery)
-- deja de llevar las fotos del producto (fotos_entrega) y se recalcula.
-- ============================================================
create or replace function public.sync_fotos_delivery_a_orden(p_orden_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_nuevo jsonb;
begin
  if p_orden_id is null then return; end if;
  select coalesce(jsonb_agg(f order by f->>'n'), '[]'::jsonb) into v_nuevo from (
    select jsonb_build_object('path', x->>'path', 'filename', coalesce(x->>'filename', 'foto.jpg'), 'tipo', 'factura',
             'quien', d.repartidor_nombre, 'pedido_id', d.id, 'n', d.created_at::text || lpad(k::text, 3, '0')) f
      from public.delivery_pedidos d, jsonb_array_elements(coalesce(d.fotos_recibo, '[]'::jsonb)) with ordinality as e(x, k)
     where d.orden_id = p_orden_id and x->>'path' is not null
  ) s;
  update public.ordenes set facturas_delivery = v_nuevo
   where id = p_orden_id and facturas_delivery is distinct from v_nuevo;
end $$;
revoke all on function public.sync_fotos_delivery_a_orden(uuid) from public, anon;

-- Solo cambia la factura: la foto del producto ya no dispara la copia.
drop trigger if exists trg_fotos_delivery_a_orden on public.delivery_pedidos;
create trigger trg_fotos_delivery_a_orden
  after insert or delete or update of fotos_recibo, orden_id, repartidor_nombre on public.delivery_pedidos
  for each row execute function public.trg_fn_fotos_delivery_a_orden();

-- Recalcular las que ya estaban copiadas
do $$ declare r record; begin
  for r in select id from public.ordenes where jsonb_array_length(facturas_delivery) > 0
           union select distinct orden_id from public.delivery_pedidos where orden_id is not null loop
    perform public.sync_fotos_delivery_a_orden(r.id);
  end loop;
end $$;

select coalesce(oc_codigo, codigo) oc, jsonb_array_length(facturas_delivery) facturas,
       (select count(*) from jsonb_array_elements(facturas_delivery) f where f->>'tipo' <> 'factura') otras
  from public.ordenes where jsonb_array_length(facturas_delivery) > 0 order by 1;
