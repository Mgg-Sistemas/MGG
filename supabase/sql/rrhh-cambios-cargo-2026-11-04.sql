-- ============================================================
-- MGG · RRHH · histórico de cambios de cargo (04-11-2026)
--
-- Pedido de la administradora: «permite poder tener un histórico de cambios
-- de cargo. Que se vea la fecha del cambio del cargo y el motivo», con su
-- reporte en PDF. Un renglón por cambio (al editar la ficha o cargado a mano
-- como histórico). Mismas reglas que `personal`: lee todo usuario registrado,
-- escribe el staff. Idempotente.
-- ============================================================
create table if not exists public.rrhh_cambios_cargo (
  id uuid primary key default gen_random_uuid(),
  personal_id uuid not null references public.personal(id) on delete cascade,
  cargo_anterior text,
  cargo_nuevo text not null,
  departamento_anterior text,
  departamento_nuevo text,
  fecha date not null,
  motivo text not null check (char_length(btrim(motivo)) >= 3),
  origen text not null default 'ficha' check (origen in ('ficha', 'historico')),
  actor text,
  actor_name text,
  created_at timestamptz not null default now()
);
create index if not exists rrhh_cambios_cargo_persona_idx on public.rrhh_cambios_cargo (personal_id, fecha desc);

alter table public.rrhh_cambios_cargo enable row level security;
revoke all on public.rrhh_cambios_cargo from anon, public;
grant select, insert, update, delete on public.rrhh_cambios_cargo to authenticated;
grant all on public.rrhh_cambios_cargo to service_role;
drop policy if exists "rrhh_cambios_cargo read auth" on public.rrhh_cambios_cargo;
create policy "rrhh_cambios_cargo read auth" on public.rrhh_cambios_cargo for select to authenticated
  using ((select auth.role()) = 'authenticated');
drop policy if exists "rrhh_cambios_cargo write staff" on public.rrhh_cambios_cargo;
create policy "rrhh_cambios_cargo write staff" on public.rrhh_cambios_cargo for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'rrhh_cambios_cargo') then
    alter publication supabase_realtime add table public.rrhh_cambios_cargo;
  end if;
end $$;

select (select relrowsecurity from pg_class where oid = 'public.rrhh_cambios_cargo'::regclass) as rls,
       (select count(*) from public.rrhh_cambios_cargo) as filas;

-- 04-11-2026 (como en GT): nota opcional del cambio.
alter table public.rrhh_cambios_cargo add column if not exists nota text;
