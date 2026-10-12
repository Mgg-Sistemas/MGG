/* ============================================================
   MGG · Choferes / Conductores · Documentos del conductor — 12/10/2026

   Licencia, certificado médico, seguro y otros papeles del conductor, con
   HISTÓRICO: cada subida es una fila nueva; la anterior del mismo tipo queda
   como versión vieja (vigente = false), nunca se borra sola. Así se sabe
   cuándo fue la última vez que se subió cada documento y quién lo subió.

   Los archivos van al bucket privado `personal-docs` (el de RRHH), bajo
   choferes/<tipo>/<personal_id>/…: sus políticas ya cubren a todo usuario
   registrado, así que no hace falta bucket ni política nueva.
   ============================================================ */
begin;

create table if not exists public.choferes_documentos (
  id                 uuid primary key default gen_random_uuid(),
  chofer_id          uuid not null references public.choferes_conductores(id) on delete cascade,
  tipo               text not null check (tipo in ('licencia', 'certificado_medico', 'seguro', 'otro')),
  etiqueta           text,
  path               text not null check (length(btrim(path)) > 0),
  nombre             text not null,
  mime               text,
  tamano             bigint,
  vence              date,
  vigente            boolean not null default true,
  subido_por         text,
  subido_por_nombre  text,
  created_at         timestamptz not null default now(),
  constraint choferes_documentos_otro_con_etiqueta check (tipo <> 'otro' or length(btrim(coalesce(etiqueta, ''))) > 0)
);
create index if not exists idx_choferes_documentos_chofer on public.choferes_documentos(chofer_id, tipo, created_at desc);
comment on table public.choferes_documentos is 'Choferes / Conductores · documentos del conductor con histórico de versiones (vigente = la última subida de su tipo).';

alter table public.choferes_documentos enable row level security;
revoke all on public.choferes_documentos from anon, public;
grant select, insert, update, delete on public.choferes_documentos to authenticated;
grant all on public.choferes_documentos to service_role;
drop policy if exists "choferes_documentos read auth" on public.choferes_documentos;
create policy "choferes_documentos read auth" on public.choferes_documentos for select to authenticated using ((select auth.uid()) is not null);
drop policy if exists "choferes_documentos write op" on public.choferes_documentos;
create policy "choferes_documentos write op" on public.choferes_documentos for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'choferes_documentos') then
    alter publication supabase_realtime add table public.choferes_documentos;
  end if;
end $$;

commit;

select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename = 'choferes_documentos';
