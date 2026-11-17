-- ============================================================
-- Módulo: choferes
-- Archivo: papelera-choferes-guias-2026-11-16.sql
-- Estado: APLICADO EN PRODUCCIÓN
-- ============================================================

begin;

-- Requiere la función de permisos de papelera-rrhh-2026-11-16.sql.
alter table public.choferes_guias
  add column if not exists eliminado_en timestamptz,
  add column if not exists eliminado_por uuid,
  add column if not exists eliminado_motivo text;

create index if not exists choferes_guias_path_idx on public.choferes_guias (path);
revoke delete on public.choferes_guias from authenticated, anon;
drop policy if exists chofer_guias_borrado_directo on public.choferes_guias;
create policy chofer_guias_borrado_directo on public.choferes_guias
  as restrictive for delete to authenticated using (false);
drop policy if exists chofer_guias_activos_update on public.choferes_guias;
create policy chofer_guias_activos_update on public.choferes_guias
  as restrictive for update to authenticated using (eliminado_en is null)
  with check (eliminado_en is null and eliminado_por is null and eliminado_motivo is null);
drop policy if exists chofer_guias_activos_insert on public.choferes_guias;
create policy chofer_guias_activos_insert on public.choferes_guias
  as restrictive for insert to authenticated
  with check (eliminado_en is null and eliminado_por is null and eliminado_motivo is null);
drop policy if exists chofer_guias_papelera_read on public.choferes_guias;
create policy chofer_guias_papelera_read on public.choferes_guias
  as restrictive for select to authenticated
  using (eliminado_en is null or (select public.puede_modulo('choferes', 'lectura')));

create table if not exists public.chofer_guias_adjuntos_por_vaciar (ruta text primary key);
alter table public.chofer_guias_adjuntos_por_vaciar enable row level security;
revoke all on public.chofer_guias_adjuntos_por_vaciar from public, anon, authenticated;
grant select on public.chofer_guias_adjuntos_por_vaciar to authenticated;
drop policy if exists chofer_guias_cola_read on public.chofer_guias_adjuntos_por_vaciar;
create policy chofer_guias_cola_read on public.chofer_guias_adjuntos_por_vaciar
  for select to authenticated using ((select public.puede_vaciar_papelera('choferes')));

create or replace function public.chofer_guias_soporte_vinculado(p_ruta text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.choferes_guias d where d.path = p_ruta);
$$;
revoke execute on function public.chofer_guias_soporte_vinculado(text) from public, anon;
grant execute on function public.chofer_guias_soporte_vinculado(text) to authenticated;

create or replace function public.chofer_guias_soporte_en_cola(p_ruta text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.chofer_guias_adjuntos_por_vaciar q where q.ruta = p_ruta);
$$;
revoke execute on function public.chofer_guias_soporte_en_cola(text) from public, anon;
grant execute on function public.chofer_guias_soporte_en_cola(text) to authenticated;

drop policy if exists chofer_guias_soporte_borrar on storage.objects;
create policy chofer_guias_soporte_borrar on storage.objects as restrictive for delete to authenticated
  using (bucket_id <> 'choferes-guias' or (
    not public.chofer_guias_soporte_vinculado(name)
    and ((select public.puede_vaciar_papelera('choferes')) or (
      (select public.puede_modulo('choferes', 'escritura')) and not public.chofer_guias_soporte_en_cola(name)
    ))
  ));
drop policy if exists chofer_guias_soporte_editar on storage.objects;
create policy chofer_guias_soporte_editar on storage.objects as restrictive for update to authenticated
  using (bucket_id <> 'choferes-guias' or not public.chofer_guias_soporte_vinculado(name))
  with check (bucket_id <> 'choferes-guias' or not public.chofer_guias_soporte_vinculado(name));

create or replace function public.chofer_guias_papelera(p_id uuid, p_motivo text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.puede_modulo('choferes', 'escritura') then
    raise exception 'Se requiere escritura en Guías de Choferes' using errcode = '42501';
  end if;
  if p_motivo is null then
    update public.choferes_guias set eliminado_en=null, eliminado_por=null, eliminado_motivo=null
     where id=p_id and eliminado_en is not null;
  else
    if char_length(trim(p_motivo)) not between 5 and 500 then
      raise exception 'Indica un motivo de 5 a 500 caracteres' using errcode = '22023';
    end if;
    update public.choferes_guias set eliminado_en=now(), eliminado_por=auth.uid(), eliminado_motivo=trim(p_motivo)
     where id=p_id and eliminado_en is null;
  end if;
  if not found then raise exception 'El estado de la guía cambió. Actualiza la lista'; end if;
end;
$$;

create or replace function public.chofer_guias_vaciar_papelera(p_ids uuid[])
returns integer language plpgsql security definer set search_path = '' as $$
declare
  cantidad integer;
begin
  if not public.puede_vaciar_papelera('choferes') then
    raise exception 'Falta el permiso Vaciar papelera en Guías de Choferes' using errcode = '42501';
  end if;
  with borrados as (
    delete from public.choferes_guias where id = any(p_ids) and eliminado_en is not null returning path
  ), encolados as (
    insert into public.chofer_guias_adjuntos_por_vaciar (ruta)
    select path from borrados where nullif(path, '') is not null on conflict do nothing
  )
  select count(*) into cantidad from borrados;
  return cantidad;
end;
$$;

create or replace function public.chofer_guias_cerrar_limpieza(p_rutas text[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.puede_vaciar_papelera('choferes') then
    raise exception 'Falta el permiso Vaciar papelera en Guías de Choferes' using errcode = '42501';
  end if;
  delete from public.chofer_guias_adjuntos_por_vaciar q
   where q.ruta = any(p_rutas) and (
     not exists (select 1 from storage.objects where bucket_id = 'choferes-guias' and name = q.ruta)
     or public.chofer_guias_soporte_vinculado(q.ruta)
   );
end;
$$;

revoke execute on function public.chofer_guias_papelera(uuid,text), public.chofer_guias_vaciar_papelera(uuid[]),
  public.chofer_guias_cerrar_limpieza(text[]) from public, anon;
grant execute on function public.chofer_guias_papelera(uuid,text), public.chofer_guias_vaciar_papelera(uuid[]),
  public.chofer_guias_cerrar_limpieza(text[]) to authenticated;

update public.roles_permisos
set permisos = coalesce(permisos, '{}'::jsonb) || jsonb_build_object(
  'rrhh', coalesce(permisos->'rrhh', '{}'::jsonb) || '{"vaciar_papelera":true}'::jsonb,
  'retenciones', coalesce(permisos->'retenciones', '{}'::jsonb) || '{"vaciar_papelera":true}'::jsonb,
  'documentacion', coalesce(permisos->'documentacion', '{}'::jsonb) || '{"vaciar_papelera":true}'::jsonb,
  'choferes', coalesce(permisos->'choferes', '{}'::jsonb) || '{"vaciar_papelera":true}'::jsonb
)
where role = 'admin';

commit;
