-- ============================================================
-- MGG · Control de Maquinaria y Vehículos · Encargado Responsable
-- Agrega la columna responsable a maquinaria_equipos
-- y catalogo de nombres de responsables
-- ============================================================

alter table public.maquinaria_equipos
  add column if not exists responsable text;

-- Índice para búsquedas rápidas por responsable
create index if not exists idx_maq_equipos_responsable on public.maquinaria_equipos(responsable);
