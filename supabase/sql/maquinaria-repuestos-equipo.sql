-- ============================================================
-- MGG · Control de Maquinaria · Ficha de repuestos y consumibles por equipo (14-10-2026)
-- Cada equipo tiene su lista de lo que lleva (aceites, filtros, cauchos, baterías…)
-- con número de parte original, equivalencias por marca, especificación, cantidad por
-- servicio, cada cuánto toca y el producto del inventario si existe.
-- Idempotente: se puede correr más de una vez. No borra nada.
-- ============================================================

create table if not exists public.maquinaria_repuestos_equipo (
  id uuid primary key default gen_random_uuid(),
  equipo_id uuid not null references public.maquinaria_equipos(id) on delete cascade,
  -- Sistema al que pertenece (motor, hidraulico, transmision, refrigeracion, combustible, aire,
  -- cabina, cauchos, electrico, correas, frenos, otros): la lista vive en la app.
  sistema text not null check (length(btrim(sistema)) > 0),
  -- Qué es: «Filtro de aceite», «Aceite de motor», «Caucho delantero»…
  tipo text not null check (length(btrim(tipo)) >= 2),
  numero_parte text,
  equivalencias text,
  especificacion text,
  cantidad numeric not null default 1 check (cantidad > 0),
  unidad text not null default 'und',
  -- Cada cuánto toca (opcional). Si va vacío, entra en todos los servicios.
  cada_horas numeric check (cada_horas is null or cada_horas > 0),
  cada_km numeric check (cada_km is null or cada_km > 0),
  producto_id uuid references public.productos(id) on delete set null,
  nota text,
  orden integer not null default 0,
  actor text,
  actor_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create index if not exists idx_maq_rep_equipo on public.maquinaria_repuestos_equipo (equipo_id, sistema, orden, tipo);
create index if not exists idx_maq_rep_producto on public.maquinaria_repuestos_equipo (producto_id);

alter table public.maquinaria_repuestos_equipo enable row level security;
revoke all on public.maquinaria_repuestos_equipo from anon;
drop policy if exists "maq_rep read auth" on public.maquinaria_repuestos_equipo;
create policy "maq_rep read auth" on public.maquinaria_repuestos_equipo for select using ((select auth.role()) = 'authenticated');
drop policy if exists "maq_rep write op" on public.maquinaria_repuestos_equipo;
create policy "maq_rep write op" on public.maquinaria_repuestos_equipo for all using ((select public.is_operativo())) with check ((select public.is_operativo()));
grant select, insert, update, delete on public.maquinaria_repuestos_equipo to authenticated;

drop trigger if exists trg_maquinaria_rep_updated_at on public.maquinaria_repuestos_equipo;
create trigger trg_maquinaria_rep_updated_at before update on public.maquinaria_repuestos_equipo for each row execute function public.set_updated_at();

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='maquinaria_repuestos_equipo') then
    alter publication supabase_realtime add table public.maquinaria_repuestos_equipo; end if;
end $$;
