-- ============================================================
-- MGG · Choferes / Conductores · tipo de viaje y cantidad de viajes (14-10-2026)
-- La hoja física se llena por día: «Jose Rondon · 25 viajes · escombros · Playa
-- Escondida → Interno». Cada orden de ruta lleva ahora:
--   · tipo_viaje: 'camion' (ruta con paradas, km, horas) o 'volqueta' (formato
--     NOMBRE · VEHÍCULO · MATERIAL · ORIGEN · DESTINO · FECHA · VIAJES);
--   · viajes: cuántos viajes se hicieron ese día (1 por defecto). La tarifa es
--     por viaje: el recibo paga tarifa × viajes.
-- YA APLICADO en la base el 14-10-2026 por el MCP; queda como respaldo.
-- Idempotente. No borra nada: los viajes existentes quedan como camión con 1 viaje.
-- ============================================================
alter table public.choferes_viajes
  add column if not exists tipo_viaje text not null default 'camion',
  add column if not exists viajes numeric not null default 1;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'choferes_viajes_tipo_chk') then
    alter table public.choferes_viajes add constraint choferes_viajes_tipo_chk check (tipo_viaje in ('camion', 'volqueta'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'choferes_viajes_viajes_chk') then
    alter table public.choferes_viajes add constraint choferes_viajes_viajes_chk check (viajes > 0);
  end if;
end $$;

create index if not exists idx_choferes_viajes_tipo on public.choferes_viajes (tipo_viaje, fecha_salida desc);
