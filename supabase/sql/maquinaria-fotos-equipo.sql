-- ============================================================
-- MGG · Maquinaria · FOTOS DEL EQUIPO aparte de los documentos (16-10-2026)
--
-- Orden de la administradora: la portada del expediente mostraba el RCV (una
-- imagen cargada como DOCUMENTO) en vez del equipo. Las fotos del equipo pasan
-- a su propia tabla `maquinaria_fotos` (hasta 8 por equipo, con orden: la 0 es
-- la portada), separadas de los 4 espacios de documentos (RCV, placa, serial…).
-- Mismo bucket privado `equipos-docs`, carpeta fotos/<equipo>/.
-- Las imágenes que la administración ya había subido como documento con el
-- nombre «FOTO DEL EQUIPO» se MUEVEN a la tabla nueva (mismo archivo; se libera
-- el espacio de documento). El resto (RCV, PLACA, SERIAL, INFO) sigue como documento.
-- Idempotente. APLICADO el 16-10-2026 vía Management API.
-- ============================================================

create table if not exists public.maquinaria_fotos (
  id          uuid primary key default gen_random_uuid(),
  equipo_id   uuid not null references public.maquinaria_equipos(id) on delete cascade,
  path        text not null,
  filename    text not null,
  mime        text,
  size_bytes  bigint,
  nombre      text,                       -- pie de foto opcional
  orden       smallint not null default 0, -- 0 = portada; luego por created_at
  created_by  text,
  created_at  timestamptz not null default now()
);
create index if not exists maquinaria_fotos_equipo_idx on public.maquinaria_fotos (equipo_id, orden, created_at);
comment on table public.maquinaria_fotos is 'Fotos del equipo (portada = orden 0). Aparte de maquinaria_documentos (RCV, placa…). Bucket equipos-docs, carpeta fotos/<equipo>/.';

alter table public.maquinaria_fotos enable row level security;
revoke all on public.maquinaria_fotos from anon;
drop policy if exists "maq_fotos read auth" on public.maquinaria_fotos;
create policy "maq_fotos read auth" on public.maquinaria_fotos for select
  using ((select auth.role()) = 'authenticated');
drop policy if exists "maq_fotos write op" on public.maquinaria_fotos;
create policy "maq_fotos write op" on public.maquinaria_fotos for all
  using ((select public.is_operativo())) with check ((select public.is_operativo()));
grant select, insert, update, delete on public.maquinaria_fotos to authenticated;

-- Realtime (regla del sistema: todo cambio llega en vivo).
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'maquinaria_fotos') then
    alter publication supabase_realtime add table public.maquinaria_fotos;
  end if;
end $$;

-- Mover a fotos lo que se subió como documento «FOTO DEL EQUIPO» (imagen). Mismo archivo
-- en el bucket: no se sube ni se borra nada; solo cambia de tabla (y libera el espacio).
with movidas as (
  insert into public.maquinaria_fotos (equipo_id, path, filename, mime, size_bytes, nombre, orden, created_by, created_at)
  select d.equipo_id, d.path, d.filename, d.mime, d.size_bytes, null, 0, d.created_by, d.created_at
    from public.maquinaria_documentos d
   where d.mime like 'image/%' and upper(btrim(d.nombre)) = 'FOTO DEL EQUIPO'
     and not exists (select 1 from public.maquinaria_fotos f where f.path = d.path)
  returning path
)
delete from public.maquinaria_documentos d using movidas m where d.path = m.path;
