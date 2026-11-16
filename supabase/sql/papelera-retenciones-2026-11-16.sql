begin;

-- Requiere el esquema de retenciones-facturas-externas.sql y la función
-- de permisos de papelera-rrhh-2026-11-16.sql.

alter table public.retencion_facturas_externas
  add column if not exists empresa_id text,
  add column if not exists empresa_nombre text,
  add column if not exists descripcion text,
  add column if not exists eliminado_en timestamptz,
  add column if not exists eliminado_por uuid,
  add column if not exists eliminado_motivo text;

revoke delete on public.retencion_facturas_externas from authenticated, anon;
drop policy if exists ret_facturas_borrado_directo on public.retencion_facturas_externas;
create policy ret_facturas_borrado_directo on public.retencion_facturas_externas
  as restrictive for delete to authenticated using (false);

insert into storage.buckets (id, name, public, file_size_limit)
values ('retenciones-facturas-externas', 'retenciones-facturas-externas', false, 12582912)
on conflict (id) do nothing;

-- La cola permanece si Storage falla después de eliminar la fila.
create table if not exists public.ret_factura_adjuntos_por_vaciar (
  bucket text not null,
  ruta text not null,
  primary key (bucket, ruta)
);
alter table public.ret_factura_adjuntos_por_vaciar enable row level security;
revoke all on public.ret_factura_adjuntos_por_vaciar from public, anon, authenticated;
grant select on public.ret_factura_adjuntos_por_vaciar to authenticated;
drop policy if exists ret_factura_cola_lectura on public.ret_factura_adjuntos_por_vaciar;
create policy ret_factura_cola_lectura on public.ret_factura_adjuntos_por_vaciar for select to authenticated
  using ((select public.puede_vaciar_papelera('retenciones')));

create or replace function public.ret_factura_soporte_permitido(p_ruta text, p_nivel text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.puede_modulo('retenciones', p_nivel) and exists (
    select 1 from public.retencion_facturas_externas f
     where f.id::text = split_part(p_ruta, '/', 1)
       and (p_nivel = 'lectura' or f.eliminado_en is null)
  );
$$;
revoke execute on function public.ret_factura_soporte_permitido(text,text) from public, anon;
grant execute on function public.ret_factura_soporte_permitido(text,text) to authenticated;

drop policy if exists ret_factura_soporte_leer on storage.objects;
create policy ret_factura_soporte_leer on storage.objects for select to authenticated
  using (bucket_id = 'retenciones-facturas-externas' and public.ret_factura_soporte_permitido(name, 'lectura'));
drop policy if exists ret_factura_soporte_subir on storage.objects;
create policy ret_factura_soporte_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'retenciones-facturas-externas' and public.ret_factura_soporte_permitido(name, 'escritura'));
drop policy if exists ret_factura_soporte_vaciar_leer on storage.objects;
create policy ret_factura_soporte_vaciar_leer on storage.objects for select to authenticated
  using (exists (select 1 from public.ret_factura_adjuntos_por_vaciar q where q.bucket = bucket_id and q.ruta = name));
drop policy if exists ret_factura_soporte_vaciar_borrar on storage.objects;
create policy ret_factura_soporte_vaciar_borrar on storage.objects for delete to authenticated
  using (exists (select 1 from public.ret_factura_adjuntos_por_vaciar q where q.bucket = bucket_id and q.ruta = name));

create or replace function public.ret_factura_soporte_legacy_vinculado(p_ruta text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.retencion_facturas_externas f
    where f.id::text = split_part(p_ruta, '/', 2));
$$;
revoke execute on function public.ret_factura_soporte_legacy_vinculado(text) from public, anon;
grant execute on function public.ret_factura_soporte_legacy_vinculado(text) to authenticated;

drop policy if exists ret_factura_legacy_editar on storage.objects;
create policy ret_factura_legacy_editar on storage.objects as restrictive for update to authenticated
  using (bucket_id <> 'compras-oc' or name not like 'facturas_externas/%'
    or not public.ret_factura_soporte_legacy_vinculado(name))
  with check (bucket_id <> 'compras-oc' or name not like 'facturas_externas/%'
    or not public.ret_factura_soporte_legacy_vinculado(name));
drop policy if exists ret_factura_legacy_borrar on storage.objects;
create policy ret_factura_legacy_borrar on storage.objects as restrictive for delete to authenticated
  using (bucket_id <> 'compras-oc' or name not like 'facturas_externas/%'
    or not public.ret_factura_soporte_legacy_vinculado(name));

drop policy if exists ret_factura_legacy_leer on storage.objects;
create policy ret_factura_legacy_leer on storage.objects as restrictive for select to authenticated
  using (bucket_id <> 'compras-oc' or name not like 'facturas_externas/%'
    or (select public.puede_modulo('retenciones', 'lectura'))
    or exists (select 1 from public.ret_factura_adjuntos_por_vaciar q where q.bucket = bucket_id and q.ruta = name));

-- Las actualizaciones ordinarias no pueden modificar ni recuperar una factura eliminada.
drop policy if exists ret_facturas_activas_write on public.retencion_facturas_externas;
create policy ret_facturas_activas_write on public.retencion_facturas_externas
  as restrictive for update to authenticated
  using (eliminado_en is null)
  with check (eliminado_en is null and eliminado_por is null and eliminado_motivo is null);

drop policy if exists ret_facturas_activas_insert on public.retencion_facturas_externas;
create policy ret_facturas_activas_insert on public.retencion_facturas_externas
  as restrictive for insert to authenticated
  with check (eliminado_en is null and eliminado_por is null and eliminado_motivo is null);

drop policy if exists ret_facturas_activas_read on public.retencion_facturas_externas;
create policy ret_facturas_activas_read on public.retencion_facturas_externas
  as restrictive for select to authenticated
  using ((select public.puede_modulo('retenciones', 'lectura')));

create or replace function public.ret_factura_papelera(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.puede_modulo('retenciones', 'escritura') then
    raise exception 'Se requiere escritura en Retenciones' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_motivo, ''))) not between 5 and 500 then
    raise exception 'Indica un motivo de 5 a 500 caracteres' using errcode = '22023';
  end if;
  update public.retencion_facturas_externas
     set eliminado_en = now(), eliminado_por = auth.uid(), eliminado_motivo = trim(p_motivo)
   where id = p_id and eliminado_en is null;
  if not found then raise exception 'La factura ya no está activa'; end if;
end;
$$;

create or replace function public.ret_factura_recuperar(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.puede_modulo('retenciones', 'escritura') then
    raise exception 'Se requiere escritura en Retenciones' using errcode = '42501';
  end if;
  update public.retencion_facturas_externas
     set eliminado_en = null, eliminado_por = null, eliminado_motivo = null
   where id = p_id and eliminado_en is not null;
  if not found then raise exception 'La factura ya no está en la papelera'; end if;
end;
$$;

create or replace function public.ret_factura_vaciar_papelera(p_ids uuid[])
returns integer language plpgsql security definer set search_path = '' as $$
declare
  cantidad integer;
begin
  if not public.puede_vaciar_papelera('retenciones') then
    raise exception 'Falta el permiso Vaciar papelera en Retenciones' using errcode = '42501';
  end if;
  with borradas as (
    delete from public.retencion_facturas_externas
     where id = any(p_ids) and eliminado_en is not null
     returning id, archivos
  ), soportes as (
    select case when path like 'facturas_externas/' || b.id::text || '/%' then 'compras-oc'
                when path like b.id::text || '/%' then 'retenciones-facturas-externas' end as bucket,
           path
      from borradas b
      cross join lateral jsonb_array_elements(case when jsonb_typeof(b.archivos) = 'array' then b.archivos else '[]'::jsonb end) a
      cross join lateral (select a->>'path' as path) s
  ), programadas as (
    insert into public.ret_factura_adjuntos_por_vaciar (bucket, ruta)
    select bucket, path from soportes where bucket is not null on conflict do nothing
  )
  select count(*) into cantidad from borradas;
  return cantidad;
end;
$$;

create or replace function public.ret_factura_cerrar_limpieza(p_bucket text, p_rutas text[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.puede_vaciar_papelera('retenciones') then
    raise exception 'Falta el permiso Vaciar papelera en Retenciones' using errcode = '42501';
  end if;
  delete from public.ret_factura_adjuntos_por_vaciar q
   where q.bucket = p_bucket and q.ruta = any(p_rutas)
     and not exists (select 1 from storage.objects o where o.bucket_id = q.bucket and o.name = q.ruta);
end;
$$;

revoke execute on function public.ret_factura_papelera(uuid, text),
  public.ret_factura_recuperar(uuid), public.ret_factura_vaciar_papelera(uuid[]),
  public.ret_factura_cerrar_limpieza(text,text[]) from public, anon;
grant execute on function public.ret_factura_papelera(uuid, text),
  public.ret_factura_recuperar(uuid), public.ret_factura_vaciar_papelera(uuid[]),
  public.ret_factura_cerrar_limpieza(text,text[]) to authenticated;

commit;
