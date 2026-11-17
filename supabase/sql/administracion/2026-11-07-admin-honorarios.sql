-- ============================================================
-- Módulo: administracion
-- Archivo: 2026-11-07-admin-honorarios.sql
-- Estado: PENDIENTE DE APLICAR EN PRODUCCIÓN
-- ------------------------------------------------------------
-- Golden Touch · Administración · Honorarios (Fase 2)
-- Fecha: 07/11/2026
-- El «job B» del diseño: estado de cuenta por profesional + pagos atómicos.
--   · admin_gestiones        (el renglón con costo: concepto libre → profesional)
--   · admin_envios_tesoreria (puente atómico 1 gestión : N envíos a Tesorería)
-- El envío reusa el flujo servicios_directos (crear → enviar a pagar); el pagado
-- y el comprobante se LEEN del servicio directo (no se duplican). Reversible
-- mientras no esté pagado. Enlaces por id BLANDOS (sin FK dura) salvo la cascada
-- gestión→envíos. Idempotente. RLS con backstop is_operativo(); BD puede afinar
-- al permiso de módulo 'administracion' como en las demás tablas admin_*.
-- ============================================================

-- 1. Gestiones (honorarios y, en general, el renglón con costo) -------------
CREATE TABLE IF NOT EXISTS admin_gestiones (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_clave   text NOT NULL,
  profesional_id  uuid,
  categoria_id    uuid,
  centro_acopio_id uuid,
  documento_id    uuid,
  concepto        text NOT NULL,
  costo_total     numeric NOT NULL DEFAULT 0,
  moneda          text NOT NULL DEFAULT 'USD',
  tasa_ref        numeric,
  fecha           date NOT NULL DEFAULT current_date,
  fecha_pactada   date,
  estado          text NOT NULL DEFAULT 'abierta',  -- 'abierta' | 'anulada' (parcial/saldada se derivan de los envíos)
  nota_acuerdo    text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_gestiones_empresa     ON admin_gestiones (empresa_clave);
CREATE INDEX IF NOT EXISTS idx_admin_gestiones_profesional ON admin_gestiones (profesional_id);

-- 2. Envíos a Tesorería (1 gestión : N envíos; reversible mientras no pagado) --
CREATE TABLE IF NOT EXISTS admin_envios_tesoreria (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gestion_id         uuid NOT NULL REFERENCES admin_gestiones(id) ON DELETE CASCADE,
  empresa_clave      text NOT NULL,
  monto              numeric NOT NULL,
  moneda             text NOT NULL DEFAULT 'USD',
  fecha_envio        timestamptz NOT NULL DEFAULT now(),
  estado             text NOT NULL DEFAULT 'enviado',  -- 'enviado' | 'pagado' | 'reversado'
  servicio_directo_id uuid,                            -- enlace BLANDO a servicios_directos
  enviado_por        text,
  pagado_en          timestamptz
);
CREATE INDEX IF NOT EXISTS idx_admin_envios_gestion  ON admin_envios_tesoreria (gestion_id);
CREATE INDEX IF NOT EXISTS idx_admin_envios_servicio ON admin_envios_tesoreria (servicio_directo_id);

-- 3. RLS (backstop de usuario operativo; BD puede afinar a permiso 'administracion') -------
ALTER TABLE admin_gestiones        ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_envios_tesoreria ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='admin_gestiones' AND policyname='admin_gestiones_operativo') THEN
    CREATE POLICY admin_gestiones_operativo ON admin_gestiones FOR ALL USING (is_operativo()) WITH CHECK (is_operativo());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='admin_envios_tesoreria' AND policyname='admin_envios_operativo') THEN
    CREATE POLICY admin_envios_operativo ON admin_envios_tesoreria FOR ALL USING (is_operativo()) WITH CHECK (is_operativo());
  END IF;
END $$;
