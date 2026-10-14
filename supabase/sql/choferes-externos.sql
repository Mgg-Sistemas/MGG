-- ============================================================
-- MGG · Choferes / Conductores · choferes externos (14-10-2026)
-- Un chofer puede NO estar en nómina (pago externo por viaje): su expediente
-- va en la misma tabla sin ficha de personal, con nombre, apellido, cédula,
-- teléfono y empresa/contratista. Los de nómina siguen igual (personal_id).
-- YA APLICADO en la base el 14-10-2026 por el MCP; queda como respaldo. Idempotente.
-- ============================================================
alter table public.choferes_conductores
  alter column personal_id drop not null,
  add column if not exists externo boolean not null default false,
  add column if not exists nombre text,
  add column if not exists apellido text,
  add column if not exists cedula text,
  add column if not exists telefono text,
  add column if not exists empresa_externa text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'choferes_conductores_externo_chk') then
    alter table public.choferes_conductores add constraint choferes_conductores_externo_chk
      check (personal_id is not null or (externo and length(btrim(coalesce(nombre, ''))) > 0));
  end if;
end $$;

comment on column public.choferes_conductores.externo is 'Chofer externo (no está en nómina): se le paga por viaje fuera de RRHH; nombre, apellido, cédula y teléfono van aquí.';
