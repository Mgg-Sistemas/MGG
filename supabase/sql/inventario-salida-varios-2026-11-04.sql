-- ============================================================
-- MGG · Inventario · teléfono · una salida con VARIOS materiales (04-11-2026)
--
-- Pedido de la administradora: «en salidas y traslados vista tlf, permite
-- poder cargar varios productos en una sola salida». Cada material sigue
-- siendo su fila (con su kardex y su retorno), pero todas comparten el mismo
-- N° SAT: el N° deja de ser único solo y pasa a ser único por material.
-- Idempotente.
-- ============================================================
alter table public.inventario_salidas_telefono drop constraint if exists inventario_salidas_telefono_codigo_key;
create unique index if not exists inventario_salidas_telefono_codigo_producto_uq
  on public.inventario_salidas_telefono (codigo, producto_id);
create index if not exists inventario_salidas_telefono_codigo_idx on public.inventario_salidas_telefono (codigo);

select (select count(*) from pg_constraint where conname = 'inventario_salidas_telefono_codigo_key') as unico_viejo,
       (select count(*) from pg_indexes where indexname = 'inventario_salidas_telefono_codigo_producto_uq') as unico_nuevo;
