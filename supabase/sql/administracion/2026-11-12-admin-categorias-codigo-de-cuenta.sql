-- ============================================================
-- Módulo: administracion
-- Archivo: 2026-11-12-admin-categorias-codigo-de-cuenta.sql
-- Estado: PENDIENTE DE APLICAR EN PRODUCCIÓN
-- ------------------------------------------------------------
-- Golden Touch · Administración · código de cuenta en las categorías
-- Fecha: 12/11/2026
--
-- POR QUÉ. Hoy una categoría del módulo es solo un nombre («Alquileres»,
-- «Financieros»). El diseño aprobado ya dice que las categorías son el «plan
-- de cuentas» que un futuro módulo de Contabilidad consumirá, pero les falta
-- lo único que hace falta para eso: el código que usa el contador.
--
-- Esto NO construye Contabilidad ni mete lógica contable en Administración:
-- es un campo de texto que la líder escribe a mano en Configuración y que
-- viaja en la exportación para el contador.
--
-- Se deja como TEXTO a propósito: los códigos de cuenta llevan puntos y ceros
-- a la izquierda («5.1.01.001»), y como número se estropearían.
--
-- Aditivo e idempotente: una columna nullable. No borra ni altera nada.
-- ============================================================

ALTER TABLE admin_categorias ADD COLUMN IF NOT EXISTS codigo_contable text;

-- Comprobación: debe devolver 1.
SELECT count(*) AS columna_creada
  FROM information_schema.columns
 WHERE table_name = 'admin_categorias'
   AND column_name = 'codigo_contable';
