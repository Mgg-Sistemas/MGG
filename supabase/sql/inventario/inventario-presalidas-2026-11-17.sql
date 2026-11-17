-- ============================================================
-- Módulo: inventario
-- Archivo: inventario-presalidas-2026-11-17.sql
-- Estado: PENDIENTE DE APLICAR EN PRODUCCIÓN
-- ------------------------------------------------------------
-- MGG · Pre-salidas de Almacén (Borradores de Salida para WhatsApp)
-- 17-11-2026.
-- Permite guardar borradores de pre-salida antes de descontar stock,
-- enviarlos a WhatsApp para aprobación, editarlos y confirmarlos
-- con el usuario autorizador una vez aprobado.
-- ============================================================

create table if not exists public.inventario_presalidas (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  almacen text not null,
  motivo text not null,
  retorna boolean not null default false,
  equipo_id text,
  equipo_nombre text,
  tipo_mant text,
  lineas jsonb not null default '[]'::jsonb,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'procesada', 'descartada')),
  autorizado_por text,
  salida_codigo text,
  salida_ids uuid[],
  actor text not null,
  actor_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists inventario_presalidas_almacen_estado_idx
  on public.inventario_presalidas (almacen, estado, created_at desc);

alter table public.inventario_presalidas enable row level security;
drop policy if exists "inventario_presalidas read" on public.inventario_presalidas;
create policy "inventario_presalidas read" on public.inventario_presalidas for select to authenticated
  using ((select public.is_admin())
      or (select public.puede_modulo('inventario', 'lectura'))
      or (select public.puede_modulo('inventario', 'escritura')));

drop policy if exists "inventario_presalidas write" on public.inventario_presalidas;
create policy "inventario_presalidas write" on public.inventario_presalidas for all to authenticated
  using ((select public.is_admin()) or (select public.puede_modulo('inventario', 'escritura')))
  with check ((select public.is_admin()) or (select public.puede_modulo('inventario', 'escritura')));

grant select, insert, update, delete on public.inventario_presalidas to authenticated;
revoke all on public.inventario_presalidas from anon;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'inventario_presalidas') then
    alter publication supabase_realtime add table public.inventario_presalidas;
  end if;
end $$;
