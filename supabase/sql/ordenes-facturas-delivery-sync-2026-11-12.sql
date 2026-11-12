-- ============================================================
-- MGG · Fotos del delivery sincronizadas en la orden de compra (12-11-2026)
--
-- Pedido de la administradora: «sincroniza las fotos de los deliverys que ya se
-- han cargado con el módulo de compras». Las fotos viven en delivery_pedidos
-- (fotos_recibo = 🧾 CARGAR FACTURA; fotos_entrega = 📷 FOTO ENTREGA EN ALMACÉN).
-- Ahora quedan copiadas en la orden (`ordenes.facturas_delivery`), con quién las
-- subió: Compras las ve en «🧾 Factura» y el botón dice cuántas hay. Un trigger
-- las mantiene al día cada vez que el delivery agrega o quita una foto, y se
-- cargan ahora las que ya estaban.
-- ============================================================
alter table public.ordenes add column if not exists facturas_delivery jsonb not null default '[]'::jsonb;
comment on column public.ordenes.facturas_delivery is
  'Copia de las fotos del delivery (delivery_pedidos): [{path, filename, tipo factura|entrega, quien, pedido_id}] en el bucket delivery-fotos.';

create or replace function public.sync_fotos_delivery_a_orden(p_orden_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_orden_id is null then return; end if;
  update public.ordenes o set facturas_delivery = coalesce((
    select jsonb_agg(f order by f->>'tipo', f->>'n') from (
      select jsonb_build_object('path', x->>'path', 'filename', coalesce(x->>'filename', 'foto.jpg'), 'tipo', 'factura',
               'quien', d.repartidor_nombre, 'pedido_id', d.id, 'n', lpad(k::text, 3, '0') || d.created_at::text) f
        from public.delivery_pedidos d, jsonb_array_elements(coalesce(d.fotos_recibo, '[]'::jsonb)) with ordinality as e(x, k)
       where d.orden_id = p_orden_id and x->>'path' is not null
      union all
      select jsonb_build_object('path', x->>'path', 'filename', coalesce(x->>'filename', 'foto.jpg'), 'tipo', 'entrega',
               'quien', d.repartidor_nombre, 'pedido_id', d.id, 'n', lpad(k::text, 3, '0') || d.created_at::text)
        from public.delivery_pedidos d, jsonb_array_elements(coalesce(d.fotos_entrega, '[]'::jsonb)) with ordinality as e(x, k)
       where d.orden_id = p_orden_id and x->>'path' is not null
    ) s), '[]'::jsonb)
  where o.id = p_orden_id
    and o.facturas_delivery is distinct from coalesce((
      select jsonb_agg(f order by f->>'tipo', f->>'n') from (
        select jsonb_build_object('path', x->>'path', 'filename', coalesce(x->>'filename', 'foto.jpg'), 'tipo', 'factura',
                 'quien', d.repartidor_nombre, 'pedido_id', d.id, 'n', lpad(k::text, 3, '0') || d.created_at::text) f
          from public.delivery_pedidos d, jsonb_array_elements(coalesce(d.fotos_recibo, '[]'::jsonb)) with ordinality as e(x, k)
         where d.orden_id = p_orden_id and x->>'path' is not null
        union all
        select jsonb_build_object('path', x->>'path', 'filename', coalesce(x->>'filename', 'foto.jpg'), 'tipo', 'entrega',
                 'quien', d.repartidor_nombre, 'pedido_id', d.id, 'n', lpad(k::text, 3, '0') || d.created_at::text)
          from public.delivery_pedidos d, jsonb_array_elements(coalesce(d.fotos_entrega, '[]'::jsonb)) with ordinality as e(x, k)
         where d.orden_id = p_orden_id and x->>'path' is not null
      ) s), '[]'::jsonb);
end $$;
revoke all on function public.sync_fotos_delivery_a_orden(uuid) from public, anon;

create or replace function public.trg_fn_fotos_delivery_a_orden()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform public.sync_fotos_delivery_a_orden(old.orden_id);
    return old;
  end if;
  perform public.sync_fotos_delivery_a_orden(new.orden_id);
  if tg_op = 'UPDATE' and old.orden_id is distinct from new.orden_id then
    perform public.sync_fotos_delivery_a_orden(old.orden_id);
  end if;
  return new;
end $$;
revoke all on function public.trg_fn_fotos_delivery_a_orden() from public, anon;

drop trigger if exists trg_fotos_delivery_a_orden on public.delivery_pedidos;
create trigger trg_fotos_delivery_a_orden
  after insert or delete or update of fotos_recibo, fotos_entrega, orden_id, repartidor_nombre on public.delivery_pedidos
  for each row execute function public.trg_fn_fotos_delivery_a_orden();

-- Las que ya se habían cargado
do $$ declare r record; begin
  for r in select distinct orden_id from public.delivery_pedidos where orden_id is not null
            and jsonb_array_length(coalesce(fotos_recibo, '[]'::jsonb)) + jsonb_array_length(coalesce(fotos_entrega, '[]'::jsonb)) > 0 loop
    perform public.sync_fotos_delivery_a_orden(r.orden_id);
  end loop;
end $$;

select coalesce(oc_codigo, codigo) oc,
       (select count(*) from jsonb_array_elements(facturas_delivery) f where f->>'tipo' = 'factura') facturas,
       (select count(*) from jsonb_array_elements(facturas_delivery) f where f->>'tipo' = 'entrega') entrega
  from public.ordenes where jsonb_array_length(facturas_delivery) > 0 order by 1;
