/* ============================================================
   MGG · RRHH · Documento del RIF del personal — 21/09/2026

   El PDF (o la foto) del RIF se guarda en un bucket PRIVADO: es un documento
   de identidad de una persona, no puede quedar con URL pública como la foto
   del carnet. Se ve con enlace firmado de 10 minutos desde RRHH.
   ============================================================ */
begin;

alter table public.personal
  add column if not exists rif_path text,
  add column if not exists rif_nombre text;

comment on column public.personal.rif_path is 'Documento del RIF en el bucket privado personal-docs';
comment on column public.personal.rif_nombre is 'Nombre original del archivo del RIF';

insert into storage.buckets (id, name, public)
values ('personal-docs', 'personal-docs', false)
on conflict (id) do nothing;

/* Cualquier usuario con sesión lee; escribe quien es operativo, igual que el
   resto de los documentos del sistema. Nunca `anon`. */
do $$
declare p text;
begin
  foreach p in array array[
    'personal docs read', 'personal docs insert', 'personal docs update', 'personal docs delete'
  ] loop
    execute format('drop policy if exists %I on storage.objects', p);
  end loop;
end $$;

create policy "personal docs read" on storage.objects
  for select to authenticated using (bucket_id = 'personal-docs');
create policy "personal docs insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'personal-docs' and (select is_operativo()));
create policy "personal docs update" on storage.objects
  for update to authenticated using (bucket_id = 'personal-docs' and (select is_operativo()));
create policy "personal docs delete" on storage.objects
  for delete to authenticated using (bucket_id = 'personal-docs' and (select is_operativo()));

commit;

select id, public from storage.buckets where id = 'personal-docs';
