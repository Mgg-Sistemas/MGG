-- ============================================================
-- MGG · Facturas de la compra: DELIVERY y ALMACÉN (11-11-2026)
--
-- Pedido de la administradora: el delivery carga la FACTURA (opcional; son sus
-- `delivery_pedidos.fotos_recibo`) y el almacenista, al recepcionar la orden,
-- DEBE cargar la factura. Compras las ve en el botón «🧾 Factura» de la OC:
-- FACTURAS DELIVERY y FACTURAS ALMACÉN. Archivos en el bucket `compras-oc`
-- (ruta <orden>/factura-almacen-…); acá se anotan.
-- ============================================================
alter table public.ordenes add column if not exists facturas_almacen jsonb not null default '[]'::jsonb;
comment on column public.ordenes.facturas_almacen is
  'Facturas que carga el almacenista al recepcionar: [{path, filename, at, por}] en el bucket compras-oc.';
select count(*) filter (where facturas_almacen is not null) from public.ordenes;
