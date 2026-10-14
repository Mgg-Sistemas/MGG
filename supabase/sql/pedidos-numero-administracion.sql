-- ============================================================
-- MGG · Número de administración del proveedor (14-10-2026)
-- Es un dato del PROVEEDOR: el número con el que su administración identifica
-- los cobros/facturas a MGG. Se pide la PRIMERA vez al indicar el método de pago
-- de una OC (obligatorio), queda en la ficha del proveedor y las próximas veces
-- viene precargado. Cada OC guarda además su copia (la ven Tesorería al pagar y
-- Retenciones al cargar los certificados).
-- Idempotente. No borra datos.
-- ============================================================

alter table public.proveedores
  add column if not exists numero_administracion text;

alter table public.ordenes
  add column if not exists numero_administracion text;

comment on column public.proveedores.numero_administracion is 'Número con el que la administración del proveedor identifica sus cobros a MGG; se carga la primera vez al indicar el método de pago de una OC';
comment on column public.ordenes.numero_administracion is 'Copia del número de administración del proveedor al indicar el método de pago (Tesorería y Retenciones lo muestran)';

-- Guardarlo desde Compras con solo el permiso de Pedidos (igual que proveedor_fijar_actividad).
create or replace function public.proveedor_fijar_numero_administracion(p_proveedor uuid, p_numero text)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not ((select public.puede_modulo('proveedores', 'escritura')) or (select public.puede_modulo('pedidos', 'escritura'))) then
    raise exception 'No autorizado.' using errcode = 'insufficient_privilege';
  end if;
  update public.proveedores set numero_administracion = nullif(btrim(p_numero), '') where id = p_proveedor;
end $$;
revoke execute on function public.proveedor_fijar_numero_administracion(uuid, text) from anon, public;
grant execute on function public.proveedor_fijar_numero_administracion(uuid, text) to authenticated;

-- Cotejo:
-- select column_name from information_schema.columns where table_name in ('proveedores','ordenes') and column_name='numero_administracion';
