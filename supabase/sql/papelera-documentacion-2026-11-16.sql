begin;

-- Requiere la función de permisos de papelera-rrhh-2026-11-16.sql.
alter table public.documentos_empresa
  add column if not exists eliminado_en timestamptz,
  add column if not exists eliminado_por uuid,
  add column if not exists eliminado_motivo text;

create index if not exists documentos_empresa_path_idx on public.documentos_empresa (path);
revoke delete on public.documentos_empresa from authenticated, anon;
drop policy if exists doc_empresa_borrado_directo on public.documentos_empresa;
create policy doc_empresa_borrado_directo on public.documentos_empresa
  as restrictive for delete to authenticated using (false);
drop policy if exists doc_empresa_activos_update on public.documentos_empresa;
create policy doc_empresa_activos_update on public.documentos_empresa
  as restrictive for update to authenticated using (eliminado_en is null)
  with check (eliminado_en is null and eliminado_por is null and eliminado_motivo is null);
drop policy if exists doc_empresa_activos_insert on public.documentos_empresa;
create policy doc_empresa_activos_insert on public.documentos_empresa
  as restrictive for insert to authenticated
  with check (eliminado_en is null and eliminado_por is null and eliminado_motivo is null);
drop policy if exists doc_empresa_papelera_read on public.documentos_empresa;
create policy doc_empresa_papelera_read on public.documentos_empresa
  as restrictive for select to authenticated
  using (eliminado_en is null or (select public.puede_modulo('documentacion', 'lectura')));

create table if not exists public.doc_empresa_adjuntos_por_vaciar (ruta text primary key);
alter table public.doc_empresa_adjuntos_por_vaciar enable row level security;
revoke all on public.doc_empresa_adjuntos_por_vaciar from public, anon, authenticated;
grant select on public.doc_empresa_adjuntos_por_vaciar to authenticated;
drop policy if exists doc_empresa_cola_read on public.doc_empresa_adjuntos_por_vaciar;
create policy doc_empresa_cola_read on public.doc_empresa_adjuntos_por_vaciar
  for select to authenticated using ((select public.puede_vaciar_papelera('documentacion')));

create or replace function public.doc_empresa_soporte_vinculado(p_ruta text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.documentos_empresa d where d.path = p_ruta);
$$;
revoke execute on function public.doc_empresa_soporte_vinculado(text) from public, anon;
grant execute on function public.doc_empresa_soporte_vinculado(text) to authenticated;

create or replace function public.doc_empresa_soporte_en_cola(p_ruta text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.doc_empresa_adjuntos_por_vaciar q where q.ruta = p_ruta);
$$;
revoke execute on function public.doc_empresa_soporte_en_cola(text) from public, anon;
grant execute on function public.doc_empresa_soporte_en_cola(text) to authenticated;

drop policy if exists doc_empresa_soporte_borrar on storage.objects;
create policy doc_empresa_soporte_borrar on storage.objects as restrictive for delete to authenticated
  using (bucket_id <> 'documentacion' or name not like 'documentos/%' or (
    not public.doc_empresa_soporte_vinculado(name)
    and ((select public.puede_vaciar_papelera('documentacion')) or (
      (select public.puede_modulo('documentacion', 'escritura')) and not public.doc_empresa_soporte_en_cola(name)
    ))
  ));
drop policy if exists doc_empresa_soporte_editar on storage.objects;
create policy doc_empresa_soporte_editar on storage.objects as restrictive for update to authenticated
  using (bucket_id <> 'documentacion' or name not like 'documentos/%' or not public.doc_empresa_soporte_vinculado(name))
  with check (bucket_id <> 'documentacion' or name not like 'documentos/%' or not public.doc_empresa_soporte_vinculado(name));

create or replace function public.doc_empresa_papelera(p_id uuid, p_motivo text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.puede_modulo('documentacion', 'escritura') then
    raise exception 'Se requiere escritura en Documentación' using errcode = '42501';
  end if;
  if p_motivo is null then
    update public.documentos_empresa set eliminado_en=null, eliminado_por=null, eliminado_motivo=null
     where id=p_id and eliminado_en is not null;
  else
    if char_length(trim(p_motivo)) not between 5 and 500 then
      raise exception 'Indica un motivo de 5 a 500 caracteres' using errcode = '22023';
    end if;
    update public.documentos_empresa set eliminado_en=now(), eliminado_por=auth.uid(), eliminado_motivo=trim(p_motivo)
     where id=p_id and eliminado_en is null;
  end if;
  if not found then raise exception 'El estado del documento cambió. Actualiza la lista'; end if;
end;
$$;

create or replace function public.doc_empresa_vaciar_papelera(p_ids uuid[])
returns integer language plpgsql security definer set search_path = '' as $$
declare
  cantidad integer;
begin
  if not public.puede_vaciar_papelera('documentacion') then
    raise exception 'Falta el permiso Vaciar papelera en Documentación' using errcode = '42501';
  end if;
  with borrados as (
    delete from public.documentos_empresa where id = any(p_ids) and eliminado_en is not null returning path
  ), encolados as (
    insert into public.doc_empresa_adjuntos_por_vaciar (ruta)
    select path from borrados where path like 'documentos/%' on conflict do nothing
  )
  select count(*) into cantidad from borrados;
  return cantidad;
end;
$$;

create or replace function public.doc_empresa_cerrar_limpieza(p_rutas text[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.puede_vaciar_papelera('documentacion') then
    raise exception 'Falta el permiso Vaciar papelera en Documentación' using errcode = '42501';
  end if;
  delete from public.doc_empresa_adjuntos_por_vaciar q
   where q.ruta = any(p_rutas) and (
     not exists (select 1 from storage.objects where bucket_id = 'documentacion' and name = q.ruta)
     or public.doc_empresa_soporte_vinculado(q.ruta)
   );
end;
$$;

revoke execute on function public.doc_empresa_papelera(uuid,text), public.doc_empresa_vaciar_papelera(uuid[]),
  public.doc_empresa_cerrar_limpieza(text[]) from public, anon;
grant execute on function public.doc_empresa_papelera(uuid,text), public.doc_empresa_vaciar_papelera(uuid[]),
  public.doc_empresa_cerrar_limpieza(text[]) to authenticated;

commit;
