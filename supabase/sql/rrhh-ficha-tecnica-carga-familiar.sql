/* ============================================================
   MGG · RRHH · Ficha técnica y carga familiar — 22/09/2026

   La ficha del trabajador tenía lo mínimo para pagarle. Le faltaba lo que
   hace falta para CONOCERLO: quién es, qué edad tiene, con quién vive, a
   quién hay que avisarle si le pasa algo.

   DOS COSAS
   1. Datos de la ficha técnica: género, estado civil, fecha de nacimiento
      (de ahí sale la edad, que no se guarda porque cambia sola), grupo
      sanguíneo, nacionalidad, dirección y el parentesco del contacto de
      emergencia.
   2. La CARGA FAMILIAR en su propia tabla: una fila por familiar. De ahí
      sale, sin preguntarlo aparte, quién tiene hijos y quién no.

   LA EDAD NO SE GUARDA
   Se guarda la fecha de nacimiento y la edad se calcula. Una edad guardada
   queda vieja al día siguiente del cumpleaños, y nadie la va a ir
   corrigiendo persona por persona.

   EL NÚMERO DE FICHA
   Correlativo por empresa, puesto por la base. MGG y GoMetal numeran cada
   una la suya: la ficha 5 de GoMetal no es la ficha 5 de MGG.
   ============================================================ */
begin;

/* ── 1) Los datos de la ficha técnica ─────────────────────────────────── */
alter table public.personal
  add column if not exists numero_ficha   integer,
  add column if not exists genero         text,
  add column if not exists estado_civil   text,
  add column if not exists fecha_nacimiento date,
  add column if not exists grupo_sanguineo text,
  add column if not exists nacionalidad   text,
  add column if not exists direccion      text,
  add column if not exists contacto_emergencia_parentesco text;

alter table public.personal drop constraint if exists personal_genero_check;
alter table public.personal add constraint personal_genero_check
  check (genero is null or genero in ('masculino', 'femenino', 'otro'));

alter table public.personal drop constraint if exists personal_estado_civil_check;
alter table public.personal add constraint personal_estado_civil_check
  check (estado_civil is null or estado_civil in
    ('soltero', 'casado', 'concubinato', 'divorciado', 'viudo'));

alter table public.personal drop constraint if exists personal_grupo_sanguineo_check;
alter table public.personal add constraint personal_grupo_sanguineo_check
  check (grupo_sanguineo is null or grupo_sanguineo in
    ('O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'));

/* La fecha de nacimiento tiene que ser creíble: ni futura ni de hace 120 años. */
alter table public.personal drop constraint if exists personal_nacimiento_check;
alter table public.personal add constraint personal_nacimiento_check
  check (fecha_nacimiento is null or
        (fecha_nacimiento <= current_date and fecha_nacimiento > current_date - interval '120 years'));

create index if not exists personal_genero_idx on public.personal (empresa, genero);
create index if not exists personal_estado_civil_idx on public.personal (empresa, estado_civil);

/* ── 2) El número de ficha, correlativo por empresa ───────────────────── */
create unique index if not exists personal_numero_ficha_idx
  on public.personal (empresa, numero_ficha) where numero_ficha is not null;

create or replace function public.personal_asignar_numero_ficha()
returns trigger
language plpgsql
as $$
begin
  if new.numero_ficha is null then
    select coalesce(max(numero_ficha), 0) + 1 into new.numero_ficha
      from public.personal where empresa = new.empresa;
  end if;
  return new;
end $$;

drop trigger if exists trg_personal_numero_ficha on public.personal;
create trigger trg_personal_numero_ficha
  before insert on public.personal
  for each row execute function public.personal_asignar_numero_ficha();

/* Las fichas que ya existían toman su número por orden de antigüedad. */
with numeradas as (
  select id, row_number() over (partition by empresa order by created_at, id) as n
  from public.personal where numero_ficha is null
)
update public.personal p set numero_ficha = numeradas.n
from numeradas where p.id = numeradas.id;

/* ── 3) La carga familiar ─────────────────────────────────────────────── */
create table if not exists public.personal_carga_familiar (
  id uuid primary key default gen_random_uuid(),
  personal_id uuid not null references public.personal(id) on delete cascade,
  nombre text not null,
  /* 'hijo' es el que importa: de ahí sale quién tiene hijos. */
  parentesco text not null,
  fecha_nacimiento date,
  genero text,
  /* Si estudia, si tiene alguna condición, lo que haga falta anotar. */
  observacion text,
  created_at timestamptz not null default now(),
  creado_por text,
  constraint carga_familiar_nombre_no_vacio check (length(btrim(nombre)) > 0),
  constraint carga_familiar_parentesco_check check (parentesco in
    ('hijo', 'conyuge', 'padre', 'madre', 'hermano', 'otro')),
  constraint carga_familiar_genero_check check (genero is null or genero in ('masculino', 'femenino', 'otro')),
  constraint carga_familiar_nacimiento_check check (fecha_nacimiento is null or fecha_nacimiento <= current_date)
);

create index if not exists carga_familiar_persona_idx
  on public.personal_carga_familiar (personal_id, parentesco);

alter table public.personal_carga_familiar enable row level security;
revoke all on public.personal_carga_familiar from anon, public;
grant select, insert, update, delete on public.personal_carga_familiar to authenticated;
grant all on public.personal_carga_familiar to service_role;

drop policy if exists "carga_familiar read auth" on public.personal_carga_familiar;
create policy "carga_familiar read auth" on public.personal_carga_familiar
  for select to authenticated using ((select auth.uid()) is not null);

drop policy if exists "carga_familiar write op" on public.personal_carga_familiar;
create policy "carga_familiar write op" on public.personal_carga_familiar
  for all to authenticated
  using ((select public.is_operativo()))
  with check ((select public.is_operativo()));

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'personal_carga_familiar'
  ) then
    alter publication supabase_realtime add table public.personal_carga_familiar;
  end if;
end $$;

commit;

select
  (select count(*) from public.personal where numero_ficha is not null) as fichas_numeradas,
  (select count(*) from public.personal_carga_familiar) as familiares;
