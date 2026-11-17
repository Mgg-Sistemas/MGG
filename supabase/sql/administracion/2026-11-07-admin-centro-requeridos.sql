-- ============================================================
-- Módulo: administracion
-- Archivo: 2026-11-07-admin-centro-requeridos.sql
-- Estado: PENDIENTE DE APLICAR EN PRODUCCIÓN
-- ------------------------------------------------------------
-- Golden Touch · Administración · Documentos requeridos por centro (Fase 5)
-- Fecha: 07/11/2026
-- Aditivo. GT intacto. El «checklist editable por centro»: qué tipos de
-- documento DEBE tener cada centro de acopio. La cobertura (N de M) se calcula
-- contra esta lista + los documentos vigentes. Enlace por id/texto BLANDO.
-- Idempotente. RLS backstop is_operativo().
-- ============================================================

CREATE TABLE IF NOT EXISTS admin_centro_requeridos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_clave  text NOT NULL,
  centro_id      text NOT NULL,
  tipo_documento text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (centro_id, tipo_documento)
);
CREATE INDEX IF NOT EXISTS idx_admin_centro_req_centro ON admin_centro_requeridos (centro_id);

ALTER TABLE admin_centro_requeridos ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='admin_centro_requeridos' AND policyname='admin_centro_req_operativo') THEN
    CREATE POLICY admin_centro_req_operativo ON admin_centro_requeridos FOR ALL USING (is_operativo()) WITH CHECK (is_operativo());
  END IF;
END $$;
