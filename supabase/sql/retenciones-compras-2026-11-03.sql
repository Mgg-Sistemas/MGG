-- ============================================================
-- MGG · Compras · retenciones por tipo al indicar el método de pago (03-11-2026)
--
-- Pedido de la administradora: el check de retención que se ocultó en
-- Tesorería pasa a Compras. Con soporte Factura se marca si retienen IVA,
-- IGTF, ISLR o ISAE (en % del total o monto fijo). Se guarda la lista en
-- ordenes.retenciones: [{tipo, modo, valor, monto}]. Si se retiene ANTES de
-- pagar, Tesorería paga el total menos las retenciones (lo calcula el front,
-- como el descuento en el pago). Idempotente.
-- ============================================================
alter table public.ordenes add column if not exists retenciones jsonb;
comment on column public.ordenes.retenciones is
  'Retenciones indicadas al enviar a pagar (03-11-2026): [{tipo: IVA|IGTF|ISLR|ISAE, modo: pct|monto, valor, monto}] en la moneda de la OC.';

select count(*) as con_retenciones from public.ordenes where retenciones is not null;
