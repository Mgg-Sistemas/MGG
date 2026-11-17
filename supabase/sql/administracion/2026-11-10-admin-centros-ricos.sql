-- ============================================================
-- Módulo: administracion
-- Archivo: 2026-11-10-admin-centros-ricos.sql
-- Estado: PENDIENTE DE APLICAR EN PRODUCCIÓN
-- ------------------------------------------------------------
-- Golden Touch · Administración · Centros de acopio con responsable y fase
-- Fecha: 10/11/2026
--
-- Hasta hoy los 4 centros estaban ESCRITOS A MANO en el código, con su
-- responsable y su fase, y no había pantalla para crearlos ni editarlos.
-- Al pasarlos a la base hay que conservar esos tres datos, o se pierde lo
-- que el reporte de Centros y Responsables ya muestra.
--
-- Aditivo e idempotente: solo añade columnas, nullables. Nada se borra ni
-- se altera. GT queda intacto.
-- ============================================================

ALTER TABLE admin_centros_acopio ADD COLUMN IF NOT EXISTS responsable_principal text;
ALTER TABLE admin_centros_acopio ADD COLUMN IF NOT EXISTS fase_predeterminada   text;
ALTER TABLE admin_centros_acopio ADD COLUMN IF NOT EXISTS descripcion           text;

-- Comprobación: debe devolver 3.
SELECT count(*) AS columnas_nuevas
  FROM information_schema.columns
 WHERE table_name = 'admin_centros_acopio'
   AND column_name IN ('responsable_principal','fase_predeterminada','descripcion');
