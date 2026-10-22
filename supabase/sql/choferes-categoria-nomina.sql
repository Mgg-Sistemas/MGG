-- ============================================================
-- MGG · Choferes y RRHH: Categorías de viaje, corte de nómina de viajes y multimoneda
-- Idempotente: seguro de correr varias veces en Supabase
-- ============================================================

-- 1. Categoría de viajes y fecha de pago de nómina de conductores
ALTER TABLE IF EXISTS choferes_viajes
  ADD COLUMN IF NOT EXISTS categoria_viaje text DEFAULT 'VIAJE CORTO',
  ADD COLUMN IF NOT EXISTS pagado_at timestamptz;

COMMENT ON COLUMN choferes_viajes.categoria_viaje IS 'Categoría del viaje: VIAJE CORTO, VIAJE LARGO o VIAJE INTERNO';
COMMENT ON COLUMN choferes_viajes.pagado_at IS 'Fecha en que se liquidó / pagó en nómina de choferes';

CREATE INDEX IF NOT EXISTS idx_choferes_viajes_pagado_at ON choferes_viajes(pagado_at);
CREATE INDEX IF NOT EXISTS idx_choferes_viajes_categoria ON choferes_viajes(categoria_viaje);

-- 2. Multimoneda en Préstamos y Anticipos de RRHH
ALTER TABLE IF EXISTS anticipos_prestamos
  ADD COLUMN IF NOT EXISTS moneda text DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS monto_original numeric(14,2),
  ADD COLUMN IF NOT EXISTS tasa_cambio numeric(14,4);

COMMENT ON COLUMN anticipos_prestamos.moneda IS 'Moneda en la que se entregó el préstamo (USD, VES, COP, EUR)';
COMMENT ON COLUMN anticipos_prestamos.monto_original IS 'Monto en la divisa original entregada';
COMMENT ON COLUMN anticipos_prestamos.tasa_cambio IS 'Tasa de cambio aplicada para la conversión a USD';

-- 3. Multimoneda en Abonos / Pagos de Préstamos
ALTER TABLE IF EXISTS anticipos_pagos
  ADD COLUMN IF NOT EXISTS moneda text DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS monto_original numeric(14,2),
  ADD COLUMN IF NOT EXISTS tasa_cambio numeric(14,4);

COMMENT ON COLUMN anticipos_pagos.moneda IS 'Moneda en la que se realizó el abono (USD, VES, COP, EUR)';
COMMENT ON COLUMN anticipos_pagos.monto_original IS 'Monto en la divisa original abonada';
COMMENT ON COLUMN anticipos_pagos.tasa_cambio IS 'Tasa de cambio aplicada para la conversión a USD';
