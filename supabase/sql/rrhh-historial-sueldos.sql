/* ============================================================
   MGG · RRHH · Historial de sueldos — 22/09/2026

   Hasta ahora el sueldo se pisaba: la ficha decía cuánto gana hoy y nadie
   podía decir desde cuándo ni por qué. Un aumento y una corrección de un
   error de tipeo se veían igual — y no son lo mismo.

   Desde ahora cada cambio deja un renglón con:
   · cuánto ganaba antes y cuánto pasa a ganar,
   · DESDE CUÁNDO rige (no siempre es el día en que se carga),
   · POR QUÉ cambió, en palabras, obligatorio,
   · y quién lo hizo.

   Un renglón del historial NO se edita ni se borra: si se cargó mal, se
   registra otro cambio que lo corrija. Un historial que se puede reescribir
   no sirve para respaldar una nómina vieja.

   El primer renglón de cada persona lo pone esta misma migración, para que
   el historial no arranque mintiendo con una ficha que ya tiene sueldo.
   ============================================================ */
begin;

create table if not exists public.personal_sueldos (
  id uuid primary key default gen_random_uuid(),
  personal_id uuid not null references public.personal(id) on delete cascade,
  /* Sueldo MENSUAL en USD, igual que personal.sueldo_base. */
  sueldo_anterior numeric(14,2) not null default 0,
  sueldo_nuevo    numeric(14,2) not null,
  /* Desde cuándo rige. Puede ser anterior al día en que se cargó. */
  vigente_desde date not null default current_date,
  /* Por qué cambió. Obligatorio: es la razón de ser de esta tabla. */
  motivo text not null,
  /* Etiqueta opcional para agrupar (aumento, ajuste, ascenso, corrección…). */
  tipo text,
  actor text,
  actor_name text,
  created_at timestamptz not null default now(),
  constraint personal_sueldos_motivo_no_vacio check (length(btrim(motivo)) > 0),
  constraint personal_sueldos_no_negativo check (sueldo_nuevo >= 0 and sueldo_anterior >= 0)
);

create index if not exists personal_sueldos_persona_idx
  on public.personal_sueldos (personal_id, vigente_desde desc, created_at desc);

/* ── RLS: leer cualquier usuario registrado, escribir los operativos ────── */
alter table public.personal_sueldos enable row level security;
revoke all on public.personal_sueldos from anon, public;
grant select, insert on public.personal_sueldos to authenticated;
grant all on public.personal_sueldos to service_role;

drop policy if exists "personal_sueldos read auth" on public.personal_sueldos;
create policy "personal_sueldos read auth" on public.personal_sueldos
  for select to authenticated using ((select auth.uid()) is not null);

/* Solo INSERT: el historial se agrega, no se corrige. No hay update ni delete
   a propósito — si un renglón quedó mal, se registra otro que lo explique. */
drop policy if exists "personal_sueldos write op" on public.personal_sueldos;
create policy "personal_sueldos write op" on public.personal_sueldos
  for insert to authenticated with check ((select is_operativo()));

/* ── Realtime: lo que carga uno lo ve el otro ───────────────────────────── */
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'personal_sueldos'
  ) then
    alter publication supabase_realtime add table public.personal_sueldos;
  end if;
end $$;

/* ── El renglón cero: lo que ya estaba cargado ──────────────────────────────
   Sin esto, una ficha con sueldo mostraría un historial vacío, como si nunca
   le hubieran puesto un sueldo. Se marca como carga inicial para no hacerlo
   pasar por una decisión que nadie tomó.                                     */
insert into public.personal_sueldos
      (personal_id, sueldo_anterior, sueldo_nuevo, vigente_desde, motivo, tipo, actor_name)
select p.id, 0, p.sueldo_base,
       coalesce(p.fecha_ingreso, p.created_at::date, current_date),
       'Sueldo con el que la ficha ya estaba cargada en el sistema, antes de que existiera el historial.',
       'inicial',
       'Sistema'
from public.personal p
where p.sueldo_base > 0
  and not exists (select 1 from public.personal_sueldos s where s.personal_id = p.id);

commit;

select count(*) as renglones_iniciales from public.personal_sueldos;
