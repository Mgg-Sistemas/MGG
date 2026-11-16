begin;

alter table public.personal_documentos
  add column if not exists eliminado_en timestamptz,
  add column if not exists eliminado_por uuid,
  add column if not exists eliminado_motivo text;
alter table public.vehiculos_catalogo
  add column if not exists eliminado_en timestamptz,
  add column if not exists eliminado_por uuid,
  add column if not exists eliminado_motivo text,
  add column if not exists eliminado_modulo text;

do $$
declare t text;
begin
  foreach t in array array['personal_documentos','vehiculos_catalogo'] loop
    execute format('revoke delete on public.%I from authenticated, anon', t);
    execute format('drop policy if exists papelera_directa_delete on public.%I', t);
    execute format('create policy papelera_directa_delete on public.%I as restrictive for delete to authenticated using (false)', t);
    execute format('drop policy if exists papelera_activos_select on public.%I', t);
    execute format('create policy papelera_activos_select on public.%I as restrictive for select to authenticated using (eliminado_en is null)', t);
    execute format('drop policy if exists papelera_activos_insert on public.%I', t);
    execute format('create policy papelera_activos_insert on public.%I as restrictive for insert to authenticated
      with check (eliminado_en is null and eliminado_por is null and eliminado_motivo is null%s)', t,
      case when t = 'vehiculos_catalogo' then ' and eliminado_modulo is null' else '' end);
    execute format('drop policy if exists papelera_activos_update on public.%I', t);
    execute format('create policy papelera_activos_update on public.%I as restrictive for update to authenticated
      using (eliminado_en is null) with check (eliminado_en is null and eliminado_por is null and eliminado_motivo is null%s)', t,
      case when t = 'vehiculos_catalogo' then ' and eliminado_modulo is null' else '' end);
  end loop;
end;
$$;

drop index if exists public.personal_documentos_persona_tipo_idx;
create unique index personal_documentos_persona_tipo_idx on public.personal_documentos(personal_id,tipo)
  where tipo <> 'otro' and eliminado_en is null;
drop index if exists public.uq_personal_documentos_otro_etiqueta;
create unique index uq_personal_documentos_otro_etiqueta on public.personal_documentos(personal_id,lower(btrim(etiqueta)))
  where tipo = 'otro' and eliminado_en is null;
create index if not exists personal_documentos_path_idx on public.personal_documentos(path);

create table if not exists public.rrhh_documentos_por_vaciar (ruta text primary key);
alter table public.rrhh_documentos_por_vaciar enable row level security;
revoke all on public.rrhh_documentos_por_vaciar from public, anon, authenticated;
grant select on public.rrhh_documentos_por_vaciar to authenticated;
drop policy if exists rrhh_documentos_por_vaciar_read on public.rrhh_documentos_por_vaciar;
create policy rrhh_documentos_por_vaciar_read on public.rrhh_documentos_por_vaciar for select to authenticated
  using ((select public.puede_vaciar_papelera('rrhh')));

create or replace function public.rrhh_papelera_soporte_libre(p_ruta text)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.personal_documentos where path=p_ruta)
    and (public.puede_vaciar_papelera('rrhh') or
         not exists (select 1 from public.rrhh_documentos_por_vaciar where ruta=p_ruta));
$$;
drop policy if exists rrhh_papelera_soporte_delete on storage.objects;
create policy rrhh_papelera_soporte_delete on storage.objects as restrictive for delete to authenticated
  using (bucket_id <> 'personal-docs' or name like 'choferes/%' or public.rrhh_papelera_soporte_libre(name));
drop policy if exists rrhh_papelera_soporte_update on storage.objects;
create policy rrhh_papelera_soporte_update on storage.objects as restrictive for update to authenticated
  using (bucket_id <> 'personal-docs' or name like 'choferes/%' or public.rrhh_papelera_soporte_libre(name))
  with check (bucket_id <> 'personal-docs' or name like 'choferes/%' or public.rrhh_papelera_soporte_libre(name));

create or replace function public.rrhh_papelera_evitar_cascada()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.eliminado_en is not null and pg_trigger_depth() > 1 then
    raise exception 'La ficha tiene un documento en la papelera de RRHH.';
  end if;
  return old;
end;
$$;
revoke execute on function public.rrhh_papelera_evitar_cascada() from public, anon, authenticated;
drop trigger if exists rrhh_papelera_evitar_cascada on public.personal_documentos;
create trigger rrhh_papelera_evitar_cascada before delete on public.personal_documentos
  for each row execute function public.rrhh_papelera_evitar_cascada();

create or replace function public.rrhh_documento_papelera(p_id uuid, p_motivo text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.puede_modulo('rrhh','escritura') then
    raise exception 'Se requiere escritura en RRHH para gestionar sus documentos' using errcode='42501';
  end if;
  if p_motivo is null then
    begin
      update public.personal_documentos set eliminado_en=null, eliminado_por=null, eliminado_motivo=null
      where id=p_id and eliminado_en is not null;
    exception when unique_violation then
      raise exception 'Ya existe un documento activo del mismo tipo o con la misma etiqueta. Revisa el documento actual antes de recuperar.';
    end;
  else
    if char_length(trim(p_motivo)) not between 5 and 500 then
      raise exception 'Indica un motivo de 5 a 500 caracteres' using errcode='22023';
    end if;
    update public.personal_documentos set eliminado_en=now(), eliminado_por=auth.uid(), eliminado_motivo=trim(p_motivo)
    where id=p_id and eliminado_en is null;
  end if;
  if not found then raise exception 'El estado del documento cambió. Actualiza la lista.'; end if;
end;
$$;

create or replace function public.rrhh_documento_papelera_listar()
returns table (id uuid, titulo text, eliminado_en timestamptz, eliminado_motivo text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.puede_modulo('rrhh','lectura') then
    raise exception 'Se requiere lectura en RRHH' using errcode='42501';
  end if;
  return query select d.id, concat_ws(' · ',concat_ws(' ',p.nombre,p.apellido),coalesce(nullif(d.etiqueta,''),d.nombre)),
    d.eliminado_en,d.eliminado_motivo from public.personal_documentos d join public.personal p on p.id=d.personal_id
    where d.eliminado_en is not null order by d.eliminado_en desc,d.id;
end;
$$;

create or replace function public.rrhh_documento_vaciar_papelera(p_ids uuid[])
returns integer language plpgsql security definer set search_path = '' as $$
declare cantidad integer;
begin
  if not public.puede_vaciar_papelera('rrhh') then
    raise exception 'Falta el permiso Vaciar papelera en RRHH' using errcode='42501';
  end if;
  with borrados as (
    delete from public.personal_documentos where id=any(p_ids) and eliminado_en is not null returning path
  ), encolados as (
    insert into public.rrhh_documentos_por_vaciar(ruta)
    select path from borrados where nullif(path,'') is not null and path not like 'choferes/%'
    on conflict do nothing
  )
  select count(*) into cantidad from borrados;
  return cantidad;
end;
$$;

create or replace function public.rrhh_documento_cerrar_limpieza(p_rutas text[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.puede_vaciar_papelera('rrhh') then
    raise exception 'Falta el permiso Vaciar papelera en RRHH' using errcode='42501';
  end if;
  delete from public.rrhh_documentos_por_vaciar q where q.ruta=any(p_rutas) and (
    not exists (select 1 from storage.objects where bucket_id='personal-docs' and name=q.ruta)
    or exists (select 1 from public.personal_documentos where path=q.ruta)
  );
end;
$$;

create or replace function public.vehiculo_papelera_cambiar(p_modulo text,p_id uuid,p_motivo text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_modulo is null or p_modulo not in ('choferes','asignaciones') or not public.puede_modulo(p_modulo,'escritura') then
    raise exception 'Se requiere escritura en el módulo de origen' using errcode='42501';
  end if;
  if p_motivo is null then
    update public.vehiculos_catalogo set eliminado_en=null,eliminado_por=null,eliminado_motivo=null,eliminado_modulo=null
    where id=p_id and eliminado_en is not null and eliminado_modulo=p_modulo;
  else
    if char_length(trim(p_motivo)) not between 5 and 500 then
      raise exception 'Indica un motivo de 5 a 500 caracteres' using errcode='22023';
    end if;
    perform 1 from public.vehiculos_catalogo where id=p_id and eliminado_en is null for update;
    if not found then raise exception 'El vehículo ya no está activo.'; end if;
    if exists(select 1 from public.asignaciones where vehiculo_id=p_id and estado='asignado') then
      raise exception 'El vehículo está asignado. Registra la devolución primero.';
    end if;
    update public.vehiculos_catalogo set eliminado_en=now(),eliminado_por=auth.uid(),
      eliminado_motivo=trim(p_motivo),eliminado_modulo=p_modulo where id=p_id;
  end if;
  if not found then raise exception 'El estado del vehículo cambió. Actualiza la lista.'; end if;
end;
$$;

create or replace function public.vehiculo_papelera_listar(p_modulo text)
returns table(id uuid,titulo text,eliminado_en timestamptz,eliminado_motivo text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_modulo is null or p_modulo not in ('choferes','asignaciones') or not public.puede_modulo(p_modulo,'lectura') then
    raise exception 'Se requiere lectura en el módulo de origen' using errcode='42501';
  end if;
  return query select v.id,concat_ws(' · ',v.placa,nullif(concat_ws(' ',v.marca,v.modelo),'')),v.eliminado_en,v.eliminado_motivo
  from public.vehiculos_catalogo v where v.eliminado_en is not null and v.eliminado_modulo=p_modulo
  order by v.eliminado_en desc,v.id;
end;
$$;

create or replace function public.vehiculo_vaciar_papelera(p_modulo text,p_ids uuid[])
returns integer language plpgsql security definer set search_path = '' as $$
declare cantidad integer;
begin
  if p_modulo is null or p_modulo not in ('choferes','asignaciones') or not public.puede_vaciar_papelera(p_modulo) then
    raise exception 'Falta el permiso Vaciar papelera en el módulo de origen' using errcode='42501';
  end if;
  delete from public.vehiculos_catalogo where id=any(p_ids) and eliminado_en is not null and eliminado_modulo=p_modulo;
  get diagnostics cantidad=row_count;
  return cantidad;
end;
$$;

create or replace function public.vehiculo_papelera_validar_referencia()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.vehiculo_id is null then return new; end if;
  if tg_op='UPDATE' and new.vehiculo_id is not distinct from old.vehiculo_id
    and not (tg_table_name='asignaciones' and to_jsonb(new)->>'estado'='asignado' and to_jsonb(old)->>'estado' is distinct from 'asignado')
    and not (tg_table_name='choferes_viajes' and to_jsonb(new)->>'estado'='en_ruta' and to_jsonb(old)->>'estado' is distinct from 'en_ruta') then
    return new;
  end if;
  perform 1 from public.vehiculos_catalogo where id=new.vehiculo_id and eliminado_en is null for key share;
  if not found then raise exception 'El vehículo está en la papelera. Recupéralo primero.'; end if;
  return new;
end;
$$;
revoke execute on function public.vehiculo_papelera_validar_referencia() from public, anon, authenticated;
drop trigger if exists vehiculo_papelera_validar_referencia on public.asignaciones;
create trigger vehiculo_papelera_validar_referencia before insert or update on public.asignaciones
  for each row execute function public.vehiculo_papelera_validar_referencia();
drop trigger if exists vehiculo_papelera_validar_referencia on public.choferes_viajes;
create trigger vehiculo_papelera_validar_referencia before insert or update on public.choferes_viajes
  for each row execute function public.vehiculo_papelera_validar_referencia();

revoke execute on function public.rrhh_documento_papelera(uuid,text), public.rrhh_documento_papelera_listar(),
  public.rrhh_documento_vaciar_papelera(uuid[]), public.rrhh_documento_cerrar_limpieza(text[]), public.rrhh_papelera_soporte_libre(text),
  public.vehiculo_papelera_cambiar(text,uuid,text), public.vehiculo_papelera_listar(text), public.vehiculo_vaciar_papelera(text,uuid[]) from public, anon;
grant execute on function public.rrhh_documento_papelera(uuid,text), public.rrhh_documento_papelera_listar(),
  public.rrhh_documento_vaciar_papelera(uuid[]), public.rrhh_documento_cerrar_limpieza(text[]), public.rrhh_papelera_soporte_libre(text),
  public.vehiculo_papelera_cambiar(text,uuid,text), public.vehiculo_papelera_listar(text), public.vehiculo_vaciar_papelera(text,uuid[]) to authenticated;

update public.roles_permisos set permisos=coalesce(permisos,'{}'::jsonb) ||
  jsonb_build_object('asignaciones',coalesce(permisos->'asignaciones','{}'::jsonb)||'{"vaciar_papelera":true}'::jsonb)
where role='admin';

commit;
