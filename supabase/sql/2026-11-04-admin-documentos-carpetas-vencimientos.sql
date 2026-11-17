-- ============================================================
-- Golden Touch · Administración · Documentos, Carpetas y Vencimientos
-- Fecha: 04/11/2026
-- Soporte para permisología minera, parafiscales (Mintras, Rupdae,
-- Ragda, Inces, IVSS), N socios, status de vencimiento (vigente,
-- por_vencer, vencido, vencido_en_tramite) e historial ligero de auditoría.
-- ============================================================

-- 1. Ampliar la tabla admin_empresa_documentos si ya existe
DO $$
BEGIN
  -- Carpeta / Categoría de archivo
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'admin_empresa_documentos' AND column_name = 'carpeta'
  ) THEN
    ALTER TABLE admin_empresa_documentos ADD COLUMN carpeta text DEFAULT 'otros';
  END IF;

  -- Fechas de vigencia y emisión
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'admin_empresa_documentos' AND column_name = 'fecha_vencimiento'
  ) THEN
    ALTER TABLE admin_empresa_documentos ADD COLUMN fecha_vencimiento date;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'admin_empresa_documentos' AND column_name = 'fecha_emision'
  ) THEN
    ALTER TABLE admin_empresa_documentos ADD COLUMN fecha_emision date;
  END IF;

  -- Status de vencimiento: vigente | por_vencer | vencido | vencido_en_tramite | no_vence
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'admin_empresa_documentos' AND column_name = 'status_vencimiento'
  ) THEN
    ALTER TABLE admin_empresa_documentos ADD COLUMN status_vencimiento text DEFAULT 'vigente';
  END IF;

  -- Datos específicos para permisología minera y socios
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'admin_empresa_documentos' AND column_name = 'socio_nombre'
  ) THEN
    ALTER TABLE admin_empresa_documentos ADD COLUMN socio_nombre text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'admin_empresa_documentos' AND column_name = 'entidad_emisora'
  ) THEN
    ALTER TABLE admin_empresa_documentos ADD COLUMN entidad_emisora text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'admin_empresa_documentos' AND column_name = 'numero_registro'
  ) THEN
    ALTER TABLE admin_empresa_documentos ADD COLUMN numero_registro text;
  END IF;

  -- Nota de trámite en curso (para 'vencido_en_tramite')
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'admin_empresa_documentos' AND column_name = 'nota_tramite'
  ) THEN
    ALTER TABLE admin_empresa_documentos ADD COLUMN nota_tramite text;
  END IF;

  -- Historial ligero de auditoría (JSON array con [{ id, fecha, actor, accion, detalle }])
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'admin_empresa_documentos' AND column_name = 'historial'
  ) THEN
    ALTER TABLE admin_empresa_documentos ADD COLUMN historial jsonb DEFAULT '[]'::jsonb;
  END IF;

  -- Fecha de última modificación
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'admin_empresa_documentos' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE admin_empresa_documentos ADD COLUMN updated_at timestamptz DEFAULT now();
  END IF;
END $$;

-- 2. Índices de optimización para búsquedas y alertas de vencimiento
CREATE INDEX IF NOT EXISTS idx_admin_docs_empresa_carpeta 
  ON admin_empresa_documentos (empresa_clave, carpeta);

CREATE INDEX IF NOT EXISTS idx_admin_docs_vencimiento 
  ON admin_empresa_documentos (fecha_vencimiento, status_vencimiento);

