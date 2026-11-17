-- ============================================================
-- Golden Touch · Administración · Tipos de documentos y Permisos
-- Fecha: 16/11/2026
--
-- PROBLEMA 1: Al subir RUM, Bomberos, Solvencias, etc., sale:
--   «violates check constraint "admin_empresa_documentos_tipo_check"»
--   Causa: La tabla original (del 03/11) solo permitía ('rif', 'acta_constitutiva',
--   'acta_modificacion', 'cedula', 'otro'). Los tipos mineros y parafiscales son nuevos.
--
-- PROBLEMA 2: Al intentar eliminar un documento («ACTA CONSTITUTIVA...») sale:
--   «No se eliminó el documento: sin permiso, o ya no existe.»
--   Causa: No existía la política de DELETE para usuarios operativos en RLS.
--
-- SOLUCIÓN:
--   1. Eliminar la restricción fija de tipos para permitir todos los tipos del sistema.
--   2. Habilitar la política de acceso y eliminación para usuarios autenticados operativos.
-- ============================================================

-- 1. Eliminar la restricción restrictiva de tipos
ALTER TABLE admin_empresa_documentos DROP CONSTRAINT IF EXISTS admin_empresa_documentos_tipo_check;

-- 2. Asegurar que RLS permita SELECT, INSERT, UPDATE y DELETE a usuarios operativos
ALTER TABLE admin_empresa_documentos ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Reemplazar políticas previas para garantizar permisos completos
  DROP POLICY IF EXISTS admin_docs_operativo ON admin_empresa_documentos;
  DROP POLICY IF EXISTS admin_docs_delete ON admin_empresa_documentos;

  -- Política para todas las operaciones (SELECT, INSERT, UPDATE, DELETE)
  CREATE POLICY admin_docs_operativo 
    ON admin_empresa_documentos 
    FOR ALL 
    TO authenticated 
    USING (is_operativo()) 
    WITH CHECK (is_operativo());

  -- Política explícita de DELETE
  CREATE POLICY admin_docs_delete 
    ON admin_empresa_documentos 
    FOR DELETE 
    TO authenticated 
    USING (is_operativo());
END $$;
