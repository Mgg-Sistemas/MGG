/* ============================================================
   MGG · RRHH · Documentación del trabajador — 22/09/2026

   Hasta ahora solo se podía cargar el RIF, y vivía en dos columnas de la
   ficha (`rif_path`, `rif_nombre`). Para tres papeles —cédula, RIF y
   currículum— eso serían seis columnas, y siete cuando pidan el próximo.

   Así que los papeles pasan a una tabla: una fila por documento.

   UNO VIGENTE POR TIPO, y se reemplaza
   El índice único (persona, tipo) deja un solo RIF, una sola cédula y un solo
   CV por persona. Cargar de nuevo REEMPLAZA: no se acumulan diez versiones de
   la misma cédula sin saber cuál es la buena.

   EL DEPÓSITO SIGUE SIENDO PRIVADO
   Son documentos de identidad: viven en `personal-docs`, que no es público, y
   se abren con un enlace firmado que caduca. Nada de esto cambia.

   EL RIF QUE YA ESTABA CARGADO SE MUDA SOLO. Las columnas viejas quedan donde
   están —acá no se borra nada— pero dejan de usarse.
   ============================================================ */
begin;

create table if not exists public.personal_documentos (
  id uuid primary key default gen_random_uuid(),
  personal_id uuid not null references public.personal(id) on delete cascade,
  /* 'cedula' | 'rif' | 'cv'. Se valida acá para que no entre cualquier cosa. */
  tipo text not null,
  /* Ruta dentro del bucket PRIVADO `personal-docs`. */
  path text not null,
  nombre text not null,
  mime text,
  tamano bigint,
  subido_por text,
  subido_por_nombre text,
  created_at timestamptz not null default now(),
  constraint personal_documentos_tipo_check check (tipo in ('cedula', 'rif', 'cv')),
  constraint personal_documentos_path_no_vacio check (length(btrim(path)) > 0)
);

/* Uno vigente por tipo: cargar de nuevo reemplaza, no acumula. */
create unique index if not exists personal_documentos_persona_tipo_idx
  on public.personal_documentos (personal_id, tipo);

/* ── RLS: leer cualquier usuario registrado, escribir los operativos ────── */
alter table public.personal_documentos enable row level security;
revoke all on public.personal_documentos from anon, public;
grant select, insert, update, delete on public.personal_documentos to authenticated;
grant all on public.personal_documentos to service_role;

drop policy if exists "personal_documentos read auth" on public.personal_documentos;
create policy "personal_documentos read auth" on public.personal_documentos
  for select to authenticated using ((select auth.uid()) is not null);

drop policy if exists "personal_documentos write op" on public.personal_documentos;
create policy "personal_documentos write op" on public.personal_documentos
  for all to authenticated
  using ((select public.is_operativo()))
  with check ((select public.is_operativo()));

/* ── Realtime: lo que carga uno lo ve el otro ───────────────────────────── */
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'personal_documentos'
  ) then
    alter publication supabase_realtime add table public.personal_documentos;
  end if;
end $$;

/* ── El RIF que ya estaba cargado se muda ────────────────────────────────
   El archivo NO se toca: sigue en la misma ruta del mismo bucket. Lo que se
   muda es el dato de dónde está.                                            */
insert into public.personal_documentos (personal_id, tipo, path, nombre, subido_por_nombre)
select p.id, 'rif', p.rif_path, coalesce(nullif(btrim(p.rif_nombre), ''), 'RIF'), 'Carga anterior'
from public.personal p
where p.rif_path is not null and btrim(p.rif_path) <> ''
on conflict (personal_id, tipo) do nothing;

commit;

select tipo, count(*) from public.personal_documentos group by tipo order by tipo;
