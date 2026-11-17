-- ============================================================
-- Golden Touch · Administración · Documentos ampliados + Vencimiento (Fase 3)
-- Fecha: 07/11/2026
-- Aditivo (columnas nullable). GT queda intacto; nada se borra ni cambia.
--   · admin_empresa_documentos: costo de gestión, enlace a la gestión que lo
--     tramitó, aviso configurable por documento, subcarpeta (anidación),
--     badge personalizado y prioridad.
--   · admin_gestiones / admin_gasto_fijo_movimientos: prioridad y aviso_dias
--     (el eje de vencimiento también los cruza).
-- Idempotente (ADD COLUMN IF NOT EXISTS). Enlaces por id BLANDOS (sin FK dura),
-- como el resto del módulo.
-- ============================================================

ALTER TABLE admin_empresa_documentos ADD COLUMN IF NOT EXISTS costo_gestion numeric;
ALTER TABLE admin_empresa_documentos ADD COLUMN IF NOT EXISTS moneda_costo  text;
ALTER TABLE admin_empresa_documentos ADD COLUMN IF NOT EXISTS gestion_id    uuid;
ALTER TABLE admin_empresa_documentos ADD COLUMN IF NOT EXISTS aviso_dias    int;
ALTER TABLE admin_empresa_documentos ADD COLUMN IF NOT EXISTS subcarpeta_id uuid;
ALTER TABLE admin_empresa_documentos ADD COLUMN IF NOT EXISTS badge_texto   text;
ALTER TABLE admin_empresa_documentos ADD COLUMN IF NOT EXISTS prioridad     text;  -- 'alta' | 'media' | 'baja'

ALTER TABLE admin_gestiones ADD COLUMN IF NOT EXISTS prioridad  text;
ALTER TABLE admin_gestiones ADD COLUMN IF NOT EXISTS aviso_dias int;

ALTER TABLE admin_gasto_fijo_movimientos ADD COLUMN IF NOT EXISTS prioridad  text;
ALTER TABLE admin_gasto_fijo_movimientos ADD COLUMN IF NOT EXISTS aviso_dias int;
