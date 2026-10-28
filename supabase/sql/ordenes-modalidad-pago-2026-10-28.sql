-- ============================================================
-- Compras · columnas de la modalidad de pago de la OC (28-10-2026)
--
-- El selector «Pago en $ (divisa) / Pago en Bs a tasa BCV» del front (commit
-- ac1fe7c, 22-10-2026) guardaba `modalidad_pago`, `pago_en_divisa` y
-- `total_divisa` en `ordenes`, pero las columnas nunca se crearon en la base.
-- Resultado: al elegir una oferta, la oferta quedaba «aceptada» y la creación de
-- la OC fallaba con 42703 (SP-2026-0216, 27-10): la orden seguía en «aprobada»
-- y el pie del modal ofrecía «Asignar por producto (multi-proveedor)».
-- ============================================================
alter table public.ordenes
  add column if not exists modalidad_pago text,
  add column if not exists pago_en_divisa boolean,
  add column if not exists total_divisa numeric;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ordenes_modalidad_pago_check') then
    alter table public.ordenes add constraint ordenes_modalidad_pago_check check (modalidad_pago is null or modalidad_pago in ('usd', 'bs'));
  end if;
end $$;
comment on column public.ordenes.modalidad_pago is 'Cómo se paga la OC: usd = en divisa (reprecio por efectivo), bs = en Bs a tasa BCV (precios cotizados).';
comment on column public.ordenes.pago_en_divisa is 'true si la OC se paga en $ (divisa).';
comment on column public.ordenes.total_divisa is 'Total de la OC si se paga en divisa (efectivo − descuento + IVA + IGTF + ajuste).';
select column_name from information_schema.columns where table_name='ordenes' and column_name in ('modalidad_pago','pago_en_divisa','total_divisa');
