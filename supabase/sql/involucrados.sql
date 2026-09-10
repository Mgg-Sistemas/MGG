-- ============================================================
-- MGG · Catálogo de INVOLUCRADOS (fundición y refinación)
--
-- Los nombres de quienes trabajaron una colada se escribían a mano,
-- uno por línea, en un cuadro de texto libre: cada quien los tipeaba
-- distinto y no había forma de corregir ni de dar de baja a nadie.
-- Ahora viven en un catálogo, igual que los hornos.
--
-- El reporte de la colada sigue guardando NOMBRES (datos.involucrados),
-- no ids: un papel ya firmado no puede cambiar de firmante porque
-- después alguien se renombró en el catálogo.
-- ============================================================

create table if not exists public.involucrados (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  -- Rol/cargo con el que participa (opcional): fundidor, ayudante, operador…
  cargo text,
  estado estado_generico not null default 'activo',
  motivo_inhabilitacion text,
  created_at timestamptz not null default now(),
  created_by text,
  updated_at timestamptz
);

-- Un nombre, una ficha: sin distinguir mayúsculas ni espacios de sobra.
create unique index if not exists involucrados_nombre_uniq
  on public.involucrados (lower(btrim(nombre)));

alter table public.involucrados enable row level security;

drop policy if exists "involucrados read auth" on public.involucrados;
create policy "involucrados read auth" on public.involucrados
  for select using (auth.role() = 'authenticated');

drop policy if exists "involucrados write operativo" on public.involucrados;
create policy "involucrados write operativo" on public.involucrados
  for all using (is_operativo()) with check (is_operativo());

-- Realtime: si alguien agrega una persona, aparece en la pantalla del resto.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'involucrados'
  ) then
    alter publication supabase_realtime add table public.involucrados;
  end if;
end $$;

-- Siembra: los nombres que ya estaban escritos a mano en las coladas y
-- refinaciones cargadas hasta hoy. Así el catálogo no arranca vacío y
-- nadie tiene que volver a tipear lo que ya existía.
insert into public.involucrados (nombre, created_by)
select distinct btrim(x.nombre), 'siembra-coladas'
from (
  select jsonb_array_elements_text(coalesce(datos->'involucrados', '[]'::jsonb)) as nombre
    from public.produccion_colada
  union all
  select jsonb_array_elements_text(coalesce(datos->'involucrados', '[]'::jsonb)) as nombre
    from public.produccion_refinacion
  union all
  select datos->>'responsable' from public.produccion_colada
  union all
  select datos->>'responsable' from public.produccion_refinacion
) x
where btrim(coalesce(x.nombre, '')) <> ''
on conflict do nothing;
