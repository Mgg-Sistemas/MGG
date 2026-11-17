-- ============================================================
-- Módulo: administracion
-- Archivo: 2026-11-12-admin-gastos-fijos-centro-y-responsable.sql
-- Estado: PENDIENTE DE APLICAR EN PRODUCCIÓN
-- ------------------------------------------------------------
-- Golden Touch · Administración · centro y responsable del gasto fijo
-- Fecha: 12/11/2026
--
-- POR QUÉ. El mismo mal que en los documentos: el código escribe
-- `centro_acopio_id` y `responsable` en `admin_gastos_fijos`, la tabla no los
-- tiene, y hasta hoy el guardado se reintentaba EN SILENCIO sin esos dos
-- campos. Por eso un gasto fijo nunca conservaba su centro ni su responsable,
-- aunque se eligieran en el formulario.
--
-- Al quitar ese reintento silencioso (para que deje de perder datos sin
-- avisar), SIN ESTAS DOS COLUMNAS la creación de gastos fijos fallaría. Hay
-- que aplicarlo junto con el de los documentos.
--
-- Aditivo e idempotente: dos columnas nullables. No borra ni altera nada.
-- ============================================================

ALTER TABLE admin_gastos_fijos ADD COLUMN IF NOT EXISTS centro_acopio_id text;
ALTER TABLE admin_gastos_fijos ADD COLUMN IF NOT EXISTS responsable      text;

-- Comprobación: debe devolver 2.
SELECT count(*) AS columnas_presentes_de_2
  FROM information_schema.columns
 WHERE table_name = 'admin_gastos_fijos'
   AND column_name IN ('centro_acopio_id', 'responsable');
