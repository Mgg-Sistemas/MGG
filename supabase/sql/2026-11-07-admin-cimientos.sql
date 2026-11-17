-- ============================================================
-- Golden Touch · Administración · Cimientos (Fase 1)
-- Fecha: 07/11/2026
-- Pasa a la base lo que hoy vive en localStorage/texto libre:
--   · admin_centros_acopio  (centros de acopio por empresa)
--   · admin_profesionales   (abogada, contador…; lista PROPIA, NO son proveedores)
--   · admin_carpetas        (carpetas de documentos, anidables por parent_id)
-- Responsables = usuarios del sistema (NO se crea tabla de personas).
-- Idempotente (create table if not exists). RLS con el backstop is_operativo();
-- BD puede afinar las policies al permiso de módulo 'administracion' como en las
-- demás tablas admin_* (que no están versionadas en el repo).
-- ============================================================

-- 1. Centros de acopio -----------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_centros_acopio (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_clave text NOT NULL,
  nombre        text NOT NULL,
  orden         int  NOT NULL DEFAULT 0,
  activo        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_centros_empresa ON admin_centros_acopio (empresa_clave);

-- 2. Profesionales (lista propia; NO proveedores) --------------------------
CREATE TABLE IF NOT EXISTS admin_profesionales (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre     text NOT NULL,
  profesion  text,
  contacto   text,
  activo     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_profesionales_activo ON admin_profesionales (activo);

-- 3. Carpetas de documentos (anidables) ------------------------------------
CREATE TABLE IF NOT EXISTS admin_carpetas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_clave text,
  nombre        text NOT NULL,
  parent_id     uuid REFERENCES admin_carpetas(id) ON DELETE SET NULL,
  orden         int  NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_carpetas_empresa ON admin_carpetas (empresa_clave);
CREATE INDEX IF NOT EXISTS idx_admin_carpetas_parent  ON admin_carpetas (parent_id);

-- 4. RLS (backstop de usuario operativo; BD puede afinar a permiso 'administracion') -------
ALTER TABLE admin_centros_acopio ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_profesionales  ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_carpetas       ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='admin_centros_acopio' AND policyname='admin_centros_operativo') THEN
    CREATE POLICY admin_centros_operativo ON admin_centros_acopio FOR ALL USING (is_operativo()) WITH CHECK (is_operativo());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='admin_profesionales' AND policyname='admin_profesionales_operativo') THEN
    CREATE POLICY admin_profesionales_operativo ON admin_profesionales FOR ALL USING (is_operativo()) WITH CHECK (is_operativo());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='admin_carpetas' AND policyname='admin_carpetas_operativo') THEN
    CREATE POLICY admin_carpetas_operativo ON admin_carpetas FOR ALL USING (is_operativo()) WITH CHECK (is_operativo());
  END IF;
END $$;
