-- ============================================================
-- Golden Touch · Administración · Habilitar eliminación de documentos
-- Fecha: 16/11/2026
--
-- EL SÍNTOMA: Al intentar eliminar un documento («ACTA CONSTITUTIVA...») sale:
--   «No se eliminó el documento: sin permiso, o ya no existe.»
--
-- LA CAUSA: La tabla `admin_empresa_documentos` fue creada en fase inicial
-- con RLS activado, pero NUNCA se le definió una política de DELETE para los
-- usuarios operativos (o autenticados), haciendo que Postgres descarte
-- silenciosamente cualquier intento de DELETE (0 filas afectadas).
--
-- SOLUCIÓN: Habilitar política FOR ALL (SELECT, INSERT, UPDATE, DELETE)
-- para usuarios operativos autenticados, igual que admin_carpetas y admin_centros.
-- ============================================================

ALTER TABLE admin_empresa_documentos ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- 1. Política general operativo
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'admin_empresa_documentos' AND policyname = 'admin_docs_operativo'
  ) THEN
    CREATE POLICY admin_docs_operativo 
      ON admin_empresa_documentos 
      FOR ALL 
      TO authenticated 
      USING (is_operativo()) 
      WITH CHECK (is_operativo());
  END IF;

  -- 2. Política explícita de DELETE por seguridad adicional
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'admin_empresa_documentos' AND cmd = 'DELETE'
  ) THEN
    CREATE POLICY admin_docs_delete 
      ON admin_empresa_documentos 
      FOR DELETE 
      TO authenticated 
      USING (is_operativo());
  END IF;
END $$;
