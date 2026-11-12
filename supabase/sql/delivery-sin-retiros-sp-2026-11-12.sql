-- ============================================================
-- MGG · Delivery · solo OC confirmadas por Compras (12-11-2026) · YA APLICADO
-- A Delivery solo llegan las OC que el analista de Compras confirma
-- (ordenes.retiro_confirmado_en, regla de delivery_pedidos_listado). Las SP
-- («Retiro Los Pinos» de lo que almacén entrega de una SP) ya no se ofrecen.
-- Los retiros tomados o en ruta seguirían visibles hasta terminarlos (no había ninguno).
-- Para volver a ofrecerlos: restaurar la versión de delivery-2026-11-02 (revisada_almacen_en…).
-- ============================================================
create or replace function public.delivery_retiro_disponible(o public.ordenes)
returns boolean language sql stable set search_path to '' as $$
  select false;
$$;
