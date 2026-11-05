-- ============================================================
-- MGG · RRHH · Minutas de reunión (05-11-2026) — traído de Golden Touch
--
-- Las mismas tablas de GT (minutas + minuta_adjuntos + bucket privado
-- minutas-adjuntos), con los permisos de MGG: lee quien tiene RRHH (lectura),
-- escribe quien tiene RRHH (escritura) o es admin. El número sale del
-- correlativo atómico por año (next_correlativo('minuta-AAAA')).
-- ============================================================

create table if not exists public.minutas (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique,
  estado text not null default 'borrador' check (estado in ('borrador', 'finalizada')),
  lugar text,
  fecha date not null,
  hora_inicio time,
  objetivo text,
  orden_dia jsonb not null default '[]'::jsonb,
  participantes jsonb not null default '[]'::jsonb,
  acuerdos jsonb not null default '[]'::jsonb,
  otros_asuntos text,
  proxima_fecha date,
  proximos_puntos jsonb not null default '[]'::jsonb,
  avances jsonb not null default '[]'::jsonb,
  observaciones text,
  anexar_adjuntos_pdf boolean not null default false,
  busq text,
  creada_por text,
  creada_en timestamptz not null default now(),
  modificada_por text,
  modificada_en timestamptz
);
create index if not exists minutas_fecha_idx on public.minutas (fecha desc);
create index if not exists minutas_estado_idx on public.minutas (estado);

create table if not exists public.minuta_adjuntos (
  id uuid primary key default gen_random_uuid(),
  minuta_id uuid not null references public.minutas(id) on delete cascade,
  nombre text not null,
  path text not null,
  tipo text not null,
  bytes integer not null,
  subido_por text,
  subido_en timestamptz not null default now()
);
create index if not exists minuta_adjuntos_minuta_idx on public.minuta_adjuntos (minuta_id);

alter table public.minutas enable row level security;
alter table public.minuta_adjuntos enable row level security;
revoke all on public.minutas, public.minuta_adjuntos from anon;
grant select, insert, update, delete on public.minutas, public.minuta_adjuntos to authenticated;

drop policy if exists "minutas leer rrhh" on public.minutas;
create policy "minutas leer rrhh" on public.minutas for select to authenticated
  using ((select public.is_admin()) or (select public.puede_modulo('rrhh', 'lectura')));
drop policy if exists "minutas escribir rrhh" on public.minutas;
create policy "minutas escribir rrhh" on public.minutas for all to authenticated
  using ((select public.is_admin()) or (select public.puede_modulo('rrhh', 'escritura')))
  with check ((select public.is_admin()) or (select public.puede_modulo('rrhh', 'escritura')));

drop policy if exists "minuta_adjuntos leer rrhh" on public.minuta_adjuntos;
create policy "minuta_adjuntos leer rrhh" on public.minuta_adjuntos for select to authenticated
  using ((select public.is_admin()) or (select public.puede_modulo('rrhh', 'lectura')));
drop policy if exists "minuta_adjuntos escribir rrhh" on public.minuta_adjuntos;
create policy "minuta_adjuntos escribir rrhh" on public.minuta_adjuntos for all to authenticated
  using ((select public.is_admin()) or (select public.puede_modulo('rrhh', 'escritura')))
  with check ((select public.is_admin()) or (select public.puede_modulo('rrhh', 'escritura')));

-- Bucket privado de los adjuntos (fotos y PDF de la reunión).
insert into storage.buckets (id, name, public) values ('minutas-adjuntos', 'minutas-adjuntos', false)
on conflict (id) do nothing;
drop policy if exists "minutas adjuntos leer" on storage.objects;
create policy "minutas adjuntos leer" on storage.objects for select to authenticated
  using (bucket_id = 'minutas-adjuntos' and ((select public.is_admin()) or (select public.puede_modulo('rrhh', 'lectura'))));
drop policy if exists "minutas adjuntos escribir" on storage.objects;
create policy "minutas adjuntos escribir" on storage.objects for insert to authenticated
  with check (bucket_id = 'minutas-adjuntos' and ((select public.is_admin()) or (select public.puede_modulo('rrhh', 'escritura'))));
drop policy if exists "minutas adjuntos borrar" on storage.objects;
create policy "minutas adjuntos borrar" on storage.objects for delete to authenticated
  using (bucket_id = 'minutas-adjuntos' and ((select public.is_admin()) or (select public.puede_modulo('rrhh', 'escritura'))));

-- Tiempo real (multiusuario): no son tablas calientes.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'minutas') then
    alter publication supabase_realtime add table public.minutas;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'minuta_adjuntos') then
    alter publication supabase_realtime add table public.minuta_adjuntos;
  end if;
end $$;
