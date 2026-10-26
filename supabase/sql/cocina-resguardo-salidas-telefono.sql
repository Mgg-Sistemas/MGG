-- ============================================================
-- Cocina · el RESGUARDO registra sus salidas de víveres desde el teléfono
-- (26-10-2026, a pedido de la administradora)
--
-- Antes un resguardo «no servía comidas»: solo almacenaba y repartía, y un
-- disparador rechazaba cualquier fila de cocina_comidas de un resguardo
-- («En un resguardo no se registran comidas…»). Desde el 26-10 la vista de
-- teléfono del resguardo registra SALIDAS DE VÍVERES diarias con el mismo
-- formulario (una «salida» con sus productos y cantidades, que descuenta el
-- inventario del resguardo). Con el disparador puesto, toda salida fallaba con
-- «No se pudo guardar».
--
-- Se quita la guardia. El control de que no se saque más de lo que hay sigue en
-- pie: lo hace mgg_guardia_consumo_cocina sobre movimientos.
-- ============================================================
drop trigger if exists trg_guardia_resguardo_sin_comidas on public.cocina_comidas;
drop function if exists public.mgg_guardia_resguardo_sin_comidas();
