/* ============================================================
   MGG · Asignaciones · Acta de entrega numerada — 12/10/2026

   Hasta ahora las asignaciones se llevaban en Drive con una carta por
   entrega: «ASIGNACIÓN 026-2026», quién entrega (la Gerente General, con
   su cédula), quién recibe, firma y huella, y un ANEXO FOTOGRÁFICO con
   la foto de lo entregado. Esta tabla es esa carta: una fila por entrega,
   con su número correlativo por año, quién entregó (foto fija de nombre,
   cédula y cargo, para que el acta no cambie si la ficha cambia), las
   fotos del anexo y el escaneo del acta ya firmada.

   Cada ítem sigue siendo su propia fila en `asignaciones` (la laptop se
   devuelve y el uniforme no); `asignaciones.acta_id` los agrupa.

   Los archivos van al bucket privado `personal-docs` (el de RRHH), bajo
   asignaciones/<acta_id>/…; sus políticas ya cubren a todo usuario
   registrado, así que no hace falta bucket ni política nueva.
   ============================================================ */
begin;

create table if not exists public.asignaciones_actas (
  id                  uuid primary key default gen_random_uuid(),
  numero              text not null check (numero ~ '^\d{3,}-\d{4}$'),
  fecha               date not null default (now() at time zone 'America/Caracas')::date,
  personal_id         uuid not null references public.personal(id) on delete restrict,
  entrega_personal_id uuid references public.personal(id) on delete set null,
  entrega_nombre      text,
  entrega_cedula      text,
  entrega_cargo       text,
  observaciones       text,
  /* [{path, filename}] · máx. 4 · anexo fotográfico */
  fotos               jsonb not null default '[]'::jsonb,
  /* El acta ya firmada (escaneo o foto), para no depender del Drive. */
  firmada_path        text,
  firmada_nombre      text,
  firmada_at          timestamptz,
  firmada_por         text,
  historico           boolean not null default false,
  creado_por          text,
  actor_name          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz
);
create unique index if not exists ux_asignaciones_actas_numero on public.asignaciones_actas(numero);
create index if not exists idx_asignaciones_actas_personal on public.asignaciones_actas(personal_id, fecha desc);
comment on table public.asignaciones_actas is 'Asignaciones · acta de entrega numerada (NNN-AAAA): quién entrega, quién recibe, fotos del anexo y el acta firmada.';

alter table public.asignaciones add column if not exists acta_id uuid references public.asignaciones_actas(id) on delete set null;
create index if not exists idx_asignaciones_acta on public.asignaciones(acta_id);

-- ───────────── Correlativo NNN-AAAA por año (con candado: dos cargas a la vez no repiten número) ─────────────
-- Si el número viene puesto (una carga histórica del Drive: «026-2026»), se respeta.
create or replace function public.asignaciones_acta_numero()
returns trigger language plpgsql set search_path to 'public' as $$
declare v_anio text; v_n int;
begin
  if new.numero is null or btrim(new.numero) = '' then
    perform pg_advisory_xact_lock(hashtext('asignaciones_actas_numero'));
    v_anio := to_char(coalesce(new.fecha, (now() at time zone 'America/Caracas')::date), 'YYYY');
    select coalesce(max(substring(numero from '^(\d+)-')::int), 0) + 1 into v_n
      from public.asignaciones_actas where numero like '%-' || v_anio;
    new.numero := lpad(v_n::text, 3, '0') || '-' || v_anio;
  end if;
  return new;
end $$;
drop trigger if exists trg_asignaciones_acta_numero on public.asignaciones_actas;
create trigger trg_asignaciones_acta_numero before insert on public.asignaciones_actas
  for each row execute function public.asignaciones_acta_numero();

-- ───────────── Acceso: solo usuarios registrados; nada para anon ─────────────
alter table public.asignaciones_actas enable row level security;
revoke all on public.asignaciones_actas from anon, public;
grant select, insert, update, delete on public.asignaciones_actas to authenticated;
grant all on public.asignaciones_actas to service_role;
drop policy if exists "asignaciones_actas read auth" on public.asignaciones_actas;
create policy "asignaciones_actas read auth" on public.asignaciones_actas for select to authenticated using ((select auth.uid()) is not null);
drop policy if exists "asignaciones_actas write op" on public.asignaciones_actas;
create policy "asignaciones_actas write op" on public.asignaciones_actas for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'asignaciones_actas') then
    alter publication supabase_realtime add table public.asignaciones_actas;
  end if;
end $$;

commit;

select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename = 'asignaciones_actas';
