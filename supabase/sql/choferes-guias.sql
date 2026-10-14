-- ============================================================
-- MGG · Choferes · Guías (PDF) (14-10-2026)
-- Apartado «Guías» del módulo de Choferes: cada guía es un PDF con su fecha,
-- número, descripción y (opcional) el conductor. Se filtra por fecha, se busca
-- por texto y se ve en el visor del sistema. Bucket PRIVADO `choferes-guias`
-- (solo PDF, 15 MB) con enlaces firmados. Idempotente. No borra nada.
-- ============================================================

create table if not exists public.choferes_guias (
  id           uuid primary key default gen_random_uuid(),
  fecha        date not null default current_date,
  numero       text,
  descripcion  text not null check (length(btrim(descripcion)) >= 2),
  conductor_id uuid references public.choferes_conductores(id) on delete set null,
  path         text not null,
  filename     text not null,
  mime         text,
  size_bytes   integer,
  nota         text,
  actor        text,
  actor_name   text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_choferes_guias_fecha on public.choferes_guias (fecha desc, created_at desc);
create index if not exists idx_choferes_guias_conductor on public.choferes_guias (conductor_id);

alter table public.choferes_guias enable row level security;
revoke all on public.choferes_guias from anon;
drop policy if exists "choferes_guias read auth" on public.choferes_guias;
create policy "choferes_guias read auth" on public.choferes_guias for select using ((select auth.role()) = 'authenticated');
drop policy if exists "choferes_guias write op" on public.choferes_guias;
create policy "choferes_guias write op" on public.choferes_guias for all using ((select public.is_operativo())) with check ((select public.is_operativo()));
grant select, insert, update, delete on public.choferes_guias to authenticated;
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='choferes_guias') then
    alter publication supabase_realtime add table public.choferes_guias; end if;
end $$;

-- Bucket privado, solo PDF, 15 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('choferes-guias', 'choferes-guias', false, 15728640, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 15728640, allowed_mime_types = array['application/pdf'];

drop policy if exists "choferes-guias read op" on storage.objects;
create policy "choferes-guias read op" on storage.objects for select using (bucket_id = 'choferes-guias' and (select public.is_operativo()));
drop policy if exists "choferes-guias insert op" on storage.objects;
create policy "choferes-guias insert op" on storage.objects for insert with check (bucket_id = 'choferes-guias' and (select public.is_operativo()));
drop policy if exists "choferes-guias update op" on storage.objects;
create policy "choferes-guias update op" on storage.objects for update
  using (bucket_id = 'choferes-guias' and ((select public.is_admin()) or owner = auth.uid()))
  with check (bucket_id = 'choferes-guias' and ((select public.is_admin()) or owner = auth.uid()));
drop policy if exists "choferes-guias delete op" on storage.objects;
create policy "choferes-guias delete op" on storage.objects for delete using (bucket_id = 'choferes-guias' and (select public.is_operativo()));

-- Cotejo:
-- select count(*) from choferes_guias;
-- select id, public, allowed_mime_types from storage.buckets where id = 'choferes-guias';
