-- ============================================================
-- Módulo: administracion
-- Archivo: 2026-11-10-admin-vaciar-modulo.sql
-- Estado: PENDIENTE DE APLICAR EN PRODUCCIÓN
-- ------------------------------------------------------------
-- Golden Touch · Administración · VACIAR EL MÓDULO
-- Fecha: 10/11/2026
--
-- Pedido de la líder: la información cargada no la metió el equipo y no es
-- correcta. Se deja el módulo EN CERO para volver a cargarlo desde los centros.
--
-- QUÉ SE BORRA: gastos fijos y sus movimientos, documentos y permisos, y las
--               tablas nuevas (gestiones, envíos, responsabilidades, avisos,
--               requeridos por centro, carpetas, centros, profesionales).
-- QUÉ NO SE TOCA: la empresa GOLDEN TOUCH 1127 (admin_empresas) y las
--               categorías de gasto (admin_categorias). Decisión de la líder.
--
-- ⚠ ESTO BORRA DATOS Y NO SE PUEDE DESHACER. Lee el bloque 1 antes de seguir.
-- ⚠ Los archivos PDF ya subidos quedan en el bucket `admin-documentos` sin
--   ficha que los apunte. No estorban ni se ven; se limpian aparte si quieres.
-- ============================================================

-- 1. ANTES: mira qué hay. Ejecuta SOLO esto primero. ----------------------
SELECT 'gastos fijos'              AS tabla, count(*) FROM admin_gastos_fijos
UNION ALL SELECT 'movimientos',      count(*) FROM admin_gasto_fijo_movimientos
UNION ALL SELECT 'documentos',       count(*) FROM admin_empresa_documentos
UNION ALL SELECT 'gestiones',        count(*) FROM admin_gestiones
UNION ALL SELECT 'envios a tesoreria', count(*) FROM admin_envios_tesoreria
UNION ALL SELECT 'responsabilidades', count(*) FROM admin_responsabilidades
UNION ALL SELECT 'avisos',           count(*) FROM admin_avisos
UNION ALL SELECT 'requeridos x centro', count(*) FROM admin_centro_requeridos
UNION ALL SELECT 'carpetas',         count(*) FROM admin_carpetas
UNION ALL SELECT 'centros',          count(*) FROM admin_centros_acopio
UNION ALL SELECT 'profesionales',    count(*) FROM admin_profesionales
UNION ALL SELECT '-- SE CONSERVA: empresas', count(*) FROM admin_empresas
UNION ALL SELECT '-- SE CONSERVA: categorias', count(*) FROM admin_categorias;

-- ⚠ FRENO: si «envios a tesoreria» NO da 0, PARA y avísame. Cada envío creó
--   una cuenta por pagar en Tesorería; borrarlo a ciegas la deja huérfana allá.

-- 2. BORRADO. Orden obligado: primero lo que cuelga, después lo que sostiene.
BEGIN;

DELETE FROM admin_gasto_fijo_movimientos;
DELETE FROM admin_gastos_fijos;

DELETE FROM admin_empresa_documentos;

DELETE FROM admin_envios_tesoreria;
DELETE FROM admin_gestiones;

DELETE FROM admin_responsabilidades;
DELETE FROM admin_avisos;
DELETE FROM admin_centro_requeridos;

DELETE FROM admin_carpetas;
DELETE FROM admin_centros_acopio;
DELETE FROM admin_profesionales;

COMMIT;

-- 3. DESPUÉS: comprueba que quedó en cero y que la empresa sigue ahí. ------
SELECT 'gastos fijos'              AS tabla, count(*) FROM admin_gastos_fijos
UNION ALL SELECT 'movimientos',      count(*) FROM admin_gasto_fijo_movimientos
UNION ALL SELECT 'documentos',       count(*) FROM admin_empresa_documentos
UNION ALL SELECT 'gestiones',        count(*) FROM admin_gestiones
UNION ALL SELECT 'envios a tesoreria', count(*) FROM admin_envios_tesoreria
UNION ALL SELECT 'responsabilidades', count(*) FROM admin_responsabilidades
UNION ALL SELECT 'avisos',           count(*) FROM admin_avisos
UNION ALL SELECT 'requeridos x centro', count(*) FROM admin_centro_requeridos
UNION ALL SELECT 'carpetas',         count(*) FROM admin_carpetas
UNION ALL SELECT 'centros',          count(*) FROM admin_centros_acopio
UNION ALL SELECT 'profesionales',    count(*) FROM admin_profesionales
UNION ALL SELECT 'DEBE SEGUIR >0: empresas', count(*) FROM admin_empresas;
