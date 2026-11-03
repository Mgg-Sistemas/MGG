-- ============================================================
-- MGG · Choferes · clasificaciones de viaje propias con su tarifa (03-11-2026)
--
-- Pedido de la administradora: en «Tasa y clasificación del viaje» poder
-- agregar clasificaciones nuevas (además de Corto / Largo / Interno, que
-- siguen saliendo de las tasas de cada conductor) con su tarifa en $.
-- choferes_viajes.categoria_viaje sigue siendo texto: guarda el nombre.
-- Idempotente.
-- ============================================================
create table if not exists public.choferes_categorias_viaje (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  icono text not null default '🛣',
  tarifa_usd numeric(14,2) not null default 0 check (tarifa_usd >= 0),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  created_by text,
  updated_at timestamptz not null default now()
);
create unique index if not exists choferes_categorias_viaje_nombre_uq on public.choferes_categorias_viaje (upper(btrim(nombre)));

alter table public.choferes_categorias_viaje enable row level security;
revoke all on public.choferes_categorias_viaje from anon, public;
grant select, insert, update, delete on public.choferes_categorias_viaje to authenticated;
grant all on public.choferes_categorias_viaje to service_role;
drop policy if exists "choferes_categorias_viaje read auth" on public.choferes_categorias_viaje;
create policy "choferes_categorias_viaje read auth" on public.choferes_categorias_viaje
  for select to authenticated using ((select auth.uid()) is not null);
drop policy if exists "choferes_categorias_viaje write op" on public.choferes_categorias_viaje;
create policy "choferes_categorias_viaje write op" on public.choferes_categorias_viaje
  for all to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'choferes_categorias_viaje') then
    alter publication supabase_realtime add table public.choferes_categorias_viaje;
  end if;
end $$;

select count(*) as categorias,
  (select relrowsecurity from pg_class where oid = 'public.choferes_categorias_viaje'::regclass) as rls
from public.choferes_categorias_viaje;
