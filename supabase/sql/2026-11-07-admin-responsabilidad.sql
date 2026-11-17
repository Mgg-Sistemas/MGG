-- ============================================================
-- Golden Touch · Administración · Responsabilidad N:N + Avisos (Fase 4)
-- Fecha: 07/11/2026
-- Aditivo. GT intacto.
--   · admin_responsabilidades: quién (usuario del sistema, por email) responde de
--     qué (carpeta|documento|gasto|gestion, por id). Muchos-a-muchos.
--   · admin_avisos: bandeja interna persistida (por_vencer|vencido|incumplido|
--     acuerdo|nota), con responsable, leído/no leído e historial.
-- Enlaces por id/email BLANDOS (sin FK dura). Idempotente. RLS backstop is_operativo();
-- BD puede afinar al permiso 'administracion'.
-- ============================================================

CREATE TABLE IF NOT EXISTS admin_responsabilidades (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_clave text NOT NULL,
  usuario_email text NOT NULL,
  objetivo_tipo text NOT NULL,  -- 'carpeta' | 'documento' | 'gasto' | 'gestion'
  objetivo_id   text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (usuario_email, objetivo_tipo, objetivo_id)
);
CREATE INDEX IF NOT EXISTS idx_admin_resp_usuario  ON admin_responsabilidades (usuario_email);
CREATE INDEX IF NOT EXISTS idx_admin_resp_objetivo ON admin_responsabilidades (objetivo_tipo, objetivo_id);

CREATE TABLE IF NOT EXISTS admin_avisos (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_clave     text NOT NULL,
  tipo              text NOT NULL,  -- 'por_vencer' | 'vencido' | 'incumplido' | 'acuerdo' | 'nota'
  origen            text NOT NULL,  -- 'documento' | 'gasto' | 'gestion' | 'envio'
  origen_id         text NOT NULL,
  responsable_email text,
  fecha             date,
  texto             text NOT NULL,
  leido             boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_avisos_empresa     ON admin_avisos (empresa_clave);
CREATE INDEX IF NOT EXISTS idx_admin_avisos_responsable ON admin_avisos (responsable_email);
CREATE INDEX IF NOT EXISTS idx_admin_avisos_leido       ON admin_avisos (leido);

ALTER TABLE admin_responsabilidades ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_avisos            ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='admin_responsabilidades' AND policyname='admin_resp_operativo') THEN
    CREATE POLICY admin_resp_operativo ON admin_responsabilidades FOR ALL USING (is_operativo()) WITH CHECK (is_operativo());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='admin_avisos' AND policyname='admin_avisos_operativo') THEN
    CREATE POLICY admin_avisos_operativo ON admin_avisos FOR ALL USING (is_operativo()) WITH CHECK (is_operativo());
  END IF;
END $$;
