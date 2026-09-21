/* ============================================================
   MGG · Compras · CD-2026-0072 estaba en USD siendo Bs — 21/09/2026

   La compra se montó con moneda USD y un total de 8.800. En dólares eso son
   $4.400 por una conexión de reducción hembra: no existe. Son 8.800 Bs.

   El modal de recepción mostraba «$ 8.800,00» porque leía la moneda de la
   compra, y la moneda estaba mal: el defecto es del dato, no de la pantalla.

   SE PUEDE CORREGIR SIN ARRASTRES: la compra está ABIERTA, sin pagar y sin
   recibir. No hay egreso de caja ni entrada de inventario que deshacer.

   Con la tasa del día en que se montó (15/09/2026 · 842,21 Bs/$) el material
   entra al inventario a Bs 8.800 ÷ 842,21 = $10,45 en total, $5,22 cada una.
   ============================================================ */
begin;

/* Guarda: si en el medio la pagaron o la recibieron, no se toca nada. */
do $$
declare r record;
begin
  select * into r from public.compras_directas where codigo = 'CD-2026-0072';
  if not found then raise exception 'No existe CD-2026-0072.'; end if;
  if r.caja_mov_id is not null then raise exception 'CD-2026-0072 ya fue PAGADA: corregir la moneda a mano, revirtiendo primero el pago.'; end if;
  if r.mov_id is not null or r.recibida_at is not null then raise exception 'CD-2026-0072 ya fue RECIBIDA: el inventario ya tomó el costo.'; end if;
  if r.credito_cxp_id is not null then raise exception 'CD-2026-0072 está a crédito: revisar la cuenta por pagar antes.'; end if;
  if r.moneda = 'Bs' then raise notice 'CD-2026-0072 ya estaba en Bs: no hace falta corregir.'; end if;
end $$;

create table if not exists public.compras_moneda_corregida_2026_09 (
  compra_id uuid primary key,
  codigo text,
  moneda_antes text,
  moneda_despues text,
  tasa_bcv_antes numeric,
  tasa_bcv_despues numeric,
  gasto numeric,
  motivo text,
  corregido_en timestamptz not null default now()
);
alter table public.compras_moneda_corregida_2026_09 enable row level security;
revoke all on public.compras_moneda_corregida_2026_09 from anon, public;
grant select on public.compras_moneda_corregida_2026_09 to authenticated;
grant all on public.compras_moneda_corregida_2026_09 to service_role;
drop policy if exists respaldo_lectura on public.compras_moneda_corregida_2026_09;
create policy respaldo_lectura on public.compras_moneda_corregida_2026_09
  for select to authenticated using (true);

insert into public.compras_moneda_corregida_2026_09
      (compra_id, codigo, moneda_antes, moneda_despues, tasa_bcv_antes, tasa_bcv_despues, gasto, motivo)
select id, codigo, moneda, 'Bs', tasa_bcv, 842.21, gasto,
       'Montada en USD siendo Bs: $4.400 por unidad no es un precio real de una conexión de plomería'
from public.compras_directas where codigo = 'CD-2026-0072'
on conflict (compra_id) do nothing;

update public.compras_directas
   set moneda = 'Bs',
       tasa_bcv = 842.21,   -- BCV del 15/09/2026, día en que se montó
       updated_at = now()
 where codigo = 'CD-2026-0072';

commit;

select codigo, moneda, gasto, tasa_bcv,
       round(gasto / tasa_bcv, 2) total_usd,
       round((gasto / tasa_bcv) / 2, 2) usd_por_unidad
from public.compras_directas where codigo = 'CD-2026-0072';
