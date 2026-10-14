-- ============================================================
-- MGG · Proveedores (14-10-2026, segunda vuelta)
-- 1) `numero_administracion` resultó ser el TELÉFONO de la administración del
--    proveedor (se pide la primera vez al indicar el método de pago; obligatorio;
--    queda en la ficha; cada OC guarda su copia). Solo cambian los comentarios.
-- 2) Actividad económica como TEXTO LIBRE en la cotización (opcional) mientras la
--    administración define el catálogo: columna aparte para no romper la FK del
--    código CIIU (`actividad_economica`). Se guarda en la ficha por RPC con el
--    permiso de Pedidos o Proveedores.
-- Idempotente. No borra datos.
-- ============================================================

comment on column public.proveedores.numero_administracion is 'Teléfono de la administración del proveedor; se carga la primera vez al indicar el método de pago de una OC (obligatorio) y queda en la ficha';
comment on column public.ordenes.numero_administracion is 'Copia del teléfono de administración del proveedor al indicar el método de pago (Tesorería y Retenciones lo muestran)';

alter table public.proveedores
  add column if not exists actividad_economica_texto text;
comment on column public.proveedores.actividad_economica_texto is 'Actividad económica escrita a mano en la cotización (opcional) mientras no haya catálogo definitivo';

create or replace function public.proveedor_fijar_actividad_texto(p_proveedor uuid, p_texto text)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not ((select public.puede_modulo('proveedores', 'escritura')) or (select public.puede_modulo('pedidos', 'escritura'))) then
    raise exception 'No autorizado.' using errcode = 'insufficient_privilege';
  end if;
  update public.proveedores set actividad_economica_texto = nullif(upper(btrim(p_texto)), '') where id = p_proveedor;
end $$;
revoke execute on function public.proveedor_fijar_actividad_texto(uuid, text) from anon, public;
grant execute on function public.proveedor_fijar_actividad_texto(uuid, text) to authenticated;

-- Cotejo:
-- select column_name from information_schema.columns where table_name='proveedores' and column_name in ('numero_administracion','actividad_economica_texto');
