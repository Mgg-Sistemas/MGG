-- ============================================================
-- MGG · Compras · Las órdenes van siempre en $ (06-11-2026)
--
-- SV-2026-0021 y SV-2026-0034 salieron en Bs siendo en $ (el precio en $ quedó
-- rotulado Bs). Toda la empresa compra en $ (81 de 81 OC del último mes); lo que
-- se paga en Bs se paga al cambio BCV del día, pero la ORDEN es en $.
-- Desde hoy la base no deja crear una orden en Bs ni pasarla a Bs. Las viejas que
-- ya están en Bs siguen como están (se pueden editar sin tocar la moneda), y una
-- sub-OC de una madre en Bs puede heredarla.
-- ============================================================
create or replace function public.ordenes_siempre_usd()
returns trigger language plpgsql set search_path to '' as $$
declare v_madre text;
begin
  if upper(coalesce(new.moneda, '')) <> 'BS' then return new; end if;
  if tg_op = 'UPDATE' and upper(coalesce(old.moneda, '')) = 'BS' then return new; end if;
  if tg_op = 'INSERT' and new.parent_orden_id is not null then
    select moneda into v_madre from public.ordenes where id = new.parent_orden_id;
    if upper(coalesce(v_madre, '')) = 'BS' then return new; end if;
  end if;
  raise exception 'Las órdenes de compra y de servicio se cargan en $ (dólares). Si el proveedor dio el precio en Bs, pásalo a $ con la tasa del día.'
    using errcode = '23514';
end $$;

drop trigger if exists trg_ordenes_siempre_usd on public.ordenes;
create trigger trg_ordenes_siempre_usd before insert or update of moneda on public.ordenes
  for each row execute function public.ordenes_siempre_usd();
