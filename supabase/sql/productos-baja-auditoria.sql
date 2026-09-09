-- ============================================================
-- MGG · Inventario · Constancia de la baja de un producto
--
-- Un producto dado de baja NO EXISTE para el sistema: no sale en el
-- inventario, ni en los almacenes, ni en el buscador global, ni se puede
-- pedir, mover o consumir. Vive solo en el botón «Dados de baja» del
-- inventario, hasta que alguien lo reactive.
--
-- Estas tres columnas son la firma de esa baja. Las 93 bajas que ya
-- existían quedan en NULL: la pantalla las muestra como «sin registro»
-- en vez de inventarles una fecha o un responsable.
--
-- Aplicado en producción el 09/09/2026.
-- ============================================================

alter table productos
  add column if not exists desactivado_en timestamptz,
  add column if not exists desactivado_por text,
  add column if not exists desactivado_motivo text;

comment on column productos.desactivado_en is 'Cuando se dio de baja el producto. Nulo en las bajas anteriores a esta columna.';
comment on column productos.desactivado_por is 'Correo de quien lo dio de baja.';
comment on column productos.desactivado_motivo is 'Por que se dio de baja.';
