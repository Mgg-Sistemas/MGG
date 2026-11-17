-- ============================================================
-- Módulo: asignaciones
-- Archivo: papelera-asignaciones-actas-2026-11-16.sql
-- Estado: APLICADO EN PRODUCCIÓN
-- ============================================================

begin;

alter table public.asignaciones add column if not exists eliminado_en timestamptz,
  add column if not exists eliminado_por uuid, add column if not exists eliminado_motivo text;

drop policy if exists asignaciones_papelera_select on public.asignaciones;
create policy asignaciones_papelera_select on public.asignaciones as restrictive for select to authenticated
  using(eliminado_en is null);
drop policy if exists asignaciones_papelera_update on public.asignaciones;
create policy asignaciones_papelera_update on public.asignaciones as restrictive for update to authenticated
  using(eliminado_en is null) with check(eliminado_en is null and eliminado_por is null and eliminado_motivo is null);
drop policy if exists asignaciones_papelera_insert on public.asignaciones;
create policy asignaciones_papelera_insert on public.asignaciones as restrictive for insert to authenticated
  with check(eliminado_en is null and eliminado_por is null and eliminado_motivo is null);
drop policy if exists asignaciones_papelera_delete on public.asignaciones;
create policy asignaciones_papelera_delete on public.asignaciones as restrictive for delete to authenticated
  using(eliminado_en is null and not descontado);

create or replace function public.asignaciones_acta_visible(p_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select not exists(select 1 from public.asignaciones where acta_id=p_id and eliminado_en is not null)
    or exists(select 1 from public.asignaciones where acta_id=p_id and eliminado_en is null);
$$;
create or replace function public.asignaciones_acta_vacia(p_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select not exists(select 1 from public.asignaciones where acta_id=p_id);
$$;
drop policy if exists asignaciones_acta_papelera_select on public.asignaciones_actas;
create policy asignaciones_acta_papelera_select on public.asignaciones_actas as restrictive for select to authenticated
  using(public.asignaciones_acta_visible(id));
drop policy if exists asignaciones_acta_papelera_update on public.asignaciones_actas;
create policy asignaciones_acta_papelera_update on public.asignaciones_actas as restrictive for update to authenticated
  using(public.asignaciones_acta_visible(id));
drop policy if exists asignaciones_acta_papelera_delete on public.asignaciones_actas;
create policy asignaciones_acta_papelera_delete on public.asignaciones_actas as restrictive for delete to authenticated
  using(public.asignaciones_acta_vacia(id));

create or replace function public.asignaciones_proteger_acta()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if (not new.fotos @> old.fotos or old.firmada_path is not null and new.firmada_path is distinct from old.firmada_path)
    and exists(select 1 from public.asignaciones where acta_id=old.id and eliminado_en is not null) then
    raise exception 'El acta tiene artículos en la papelera y sus adjuntos están protegidos.';
  end if;
  return new;
end;
$$;
drop trigger if exists asignaciones_proteger_acta on public.asignaciones_actas;
create trigger asignaciones_proteger_acta before update of fotos,firmada_path on public.asignaciones_actas
  for each row execute function public.asignaciones_proteger_acta();

create or replace function public.asignaciones_proteger_cascada()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.eliminado_en is not null and pg_trigger_depth()>1 then
    raise exception 'La ficha tiene asignaciones en la papelera.';
  end if;
  return old;
end;
$$;
drop trigger if exists asignaciones_proteger_cascada on public.asignaciones;
create trigger asignaciones_proteger_cascada before delete on public.asignaciones
  for each row execute function public.asignaciones_proteger_cascada();

create or replace function public.asignaciones_proteger_movimiento()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.asignaciones where id=new.ref_id::uuid and eliminado_en is null for update;
  if not found then raise exception 'La asignación está en la papelera o ya no existe.'; end if;
  return new;
end;
$$;
revoke execute on function public.asignaciones_proteger_movimiento() from public,anon,authenticated;
drop trigger if exists asignaciones_proteger_movimiento on public.movimientos;
create trigger asignaciones_proteger_movimiento before insert on public.movimientos
  for each row when (new.ref_tipo in ('asignacion','asignacion_retorno') and new.ref_id is not null)
  execute function public.asignaciones_proteger_movimiento();

create or replace function public.asignaciones_papelera_cambiar(p_id uuid,p_motivo text default null)
returns void language plpgsql security definer set search_path='' as $$
declare
  a public.asignaciones%rowtype; ubicacion text; antes numeric; costo numeric; delta numeric;
  total numeric; precio_nuevo numeric; correo text; persona text; usuario_nombre text;
begin
  if not public.puede_modulo('asignaciones','escritura') then
    raise exception 'Se requiere escritura en Asignaciones' using errcode='42501';
  end if;
  if p_motivo is not null and char_length(trim(p_motivo)) not between 5 and 500 then
    raise exception 'Indica un motivo de 5 a 500 caracteres' using errcode='22023';
  end if;
  select * into a from public.asignaciones where id=p_id for update;
  if not found or (a.eliminado_en is null)<>(p_motivo is not null) then
    raise exception 'La asignación cambió de estado. Actualiza la lista.';
  end if;
  if p_motivo is not null and exists(select 1 from public.movimientos where ref_id=a.id::text
     and ref_tipo in ('asignacion','asignacion_retorno') and created_at>a.updated_at) then
    raise exception 'Hay un movimiento de stock pendiente en esta asignación. Actualiza la lista antes de archivar.';
  end if;
  perform 1 from public.asignaciones_actas where id=a.acta_id for update;
  if a.descontado then
    select coalesce(nullif(trim(a.almacen),''),nullif(trim(p.almacen),''),'General') into ubicacion
      from public.productos p where p.id=a.producto_id for update;
    if not found then raise exception 'El producto de la asignación ya no existe.'; end if;
    insert into public.existencias(producto_id,almacen) values(a.producto_id,ubicacion) on conflict do nothing;
    select stock,costo_promedio into antes,costo from public.existencias
      where producto_id=a.producto_id and almacen=ubicacion for update;
    delta:=case when p_motivo is not null then a.cantidad else -a.cantidad end;
    if antes+delta<0 then raise exception 'No hay stock suficiente para recuperar la asignación.'; end if;
    select email,nombre into correo,usuario_nombre from public.usuarios where id=auth.uid();
    select concat_ws(' ',nombre,apellido) into persona from public.personal where id=a.personal_id;
    insert into public.movimientos(producto_id,almacen,tipo,delta,stock_antes,stock_despues,actor,actor_name,ref_tipo,ref_id,detalle,costo_promedio)
      values(a.producto_id,ubicacion,
        case when delta>0 then 'entrada'::public.tipo_movimiento else 'salida'::public.tipo_movimiento end,
        delta,antes,antes+delta,coalesce(correo,auth.uid()::text),usuario_nombre,
        'asignacion_papelera',a.id,
        concat_ws(' · ',case when delta>0 then 'Asignación archivada' else 'Asignación recuperada' end,a.descripcion,persona),costo);
    update public.existencias set stock=antes+delta,updated_at=now() where producto_id=a.producto_id and almacen=ubicacion;
    select coalesce(sum(stock),0),round(sum(stock*costo_promedio) filter(where costo_promedio>0)
      /nullif(sum(stock) filter(where costo_promedio>0),0),2)
      into total,precio_nuevo from public.existencias where producto_id=a.producto_id;
    update public.productos p set stock=total,precio=coalesce(precio_nuevo,p.precio) where id=a.producto_id;
  end if;
  if p_motivo is null then
    update public.asignaciones set eliminado_en=null,eliminado_por=null,eliminado_motivo=null where id=p_id;
  else
    update public.asignaciones set eliminado_en=now(),eliminado_por=auth.uid(),eliminado_motivo=trim(p_motivo) where id=p_id;
  end if;
end;
$$;

create or replace function public.asignaciones_papelera_listar()
returns table(id text,titulo text,eliminado_en timestamptz,eliminado_motivo text)
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.puede_modulo('asignaciones','lectura') then
    raise exception 'Se requiere lectura en Asignaciones' using errcode='42501';
  end if;
  return query select a.id::text,concat_ws(' · ',a.descripcion,concat_ws(' ',p.nombre,p.apellido),act.numero),
    a.eliminado_en,a.eliminado_motivo from public.asignaciones a
    join public.personal p on p.id=a.personal_id left join public.asignaciones_actas act on act.id=a.acta_id
    where a.eliminado_en is not null order by a.eliminado_en desc,a.id;
end;
$$;

create table if not exists public.asignaciones_adjuntos_por_vaciar (ruta text primary key);
alter table public.asignaciones_adjuntos_por_vaciar enable row level security;
revoke all on public.asignaciones_adjuntos_por_vaciar from public,anon,authenticated;
grant select on public.asignaciones_adjuntos_por_vaciar to authenticated;
drop policy if exists asignaciones_limpieza_lectura on public.asignaciones_adjuntos_por_vaciar;
create policy asignaciones_limpieza_lectura on public.asignaciones_adjuntos_por_vaciar for select to authenticated
  using ((select public.puede_vaciar_papelera('asignaciones')));

create or replace function public.asignaciones_papelera_vaciar(p_ids uuid[])
returns integer language plpgsql security definer set search_path='' as $$
declare d record; a public.asignaciones_actas%rowtype; total integer:=0;
begin
  if not public.puede_vaciar_papelera('asignaciones') then
    raise exception 'Falta el permiso Vaciar papelera en Asignaciones' using errcode='42501';
  end if;
  for d in select id,acta_id from public.asignaciones where id=any(p_ids) and eliminado_en is not null order by acta_id,id for update loop
    select * into a from public.asignaciones_actas where id=d.acta_id for update;
    delete from public.asignaciones where id=d.id;
    total:=total+1;
    if a.id is not null and public.asignaciones_acta_vacia(a.id) then
      insert into public.asignaciones_adjuntos_por_vaciar(ruta)
        select ruta from (
          select a.firmada_path as ruta union select f->>'path' from jsonb_array_elements(a.fotos) f
        ) archivos where ruta like 'asignaciones/'||a.id::text||'/%' on conflict do nothing;
      delete from public.asignaciones_actas where id=a.id;
    end if;
  end loop;
  return total;
end;
$$;

create or replace function public.asignaciones_adjunto_referenciado(p_ruta text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.asignaciones_actas a where split_part(p_ruta,'/',2)=a.id::text
    and (a.firmada_path=p_ruta or a.fotos @> jsonb_build_array(jsonb_build_object('path',p_ruta))));
$$;
create or replace function public.asignaciones_adjunto_libre(p_ruta text)
returns boolean language sql stable security definer set search_path='' as $$
  select not public.asignaciones_adjunto_referenciado(p_ruta)
    and (public.puede_vaciar_papelera('asignaciones') or not exists(
      select 1 from public.asignaciones_adjuntos_por_vaciar where ruta=p_ruta));
$$;
create or replace function public.asignaciones_papelera_cerrar_limpieza(p_rutas text[])
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.puede_vaciar_papelera('asignaciones') then
    raise exception 'Falta el permiso Vaciar papelera en Asignaciones' using errcode='42501';
  end if;
  delete from public.asignaciones_adjuntos_por_vaciar q where q.ruta=any(p_rutas) and (
    public.asignaciones_adjunto_referenciado(q.ruta) or
    not exists(select 1 from storage.objects where bucket_id='personal-docs' and name=q.ruta));
end;
$$;

drop policy if exists asignaciones_papelera_storage_delete on storage.objects;
create policy asignaciones_papelera_storage_delete on storage.objects as restrictive for delete to authenticated
  using(bucket_id<>'personal-docs' or name not like 'asignaciones/%' or public.asignaciones_adjunto_libre(name));
drop policy if exists asignaciones_papelera_storage_update on storage.objects;
create policy asignaciones_papelera_storage_update on storage.objects as restrictive for update to authenticated
  using(bucket_id<>'personal-docs' or name not like 'asignaciones/%' or public.asignaciones_adjunto_libre(name))
  with check(bucket_id<>'personal-docs' or name not like 'asignaciones/%' or public.asignaciones_adjunto_libre(name));

revoke execute on function public.asignaciones_acta_visible(uuid),public.asignaciones_acta_vacia(uuid),
  public.asignaciones_adjunto_referenciado(text),public.asignaciones_adjunto_libre(text),public.asignaciones_proteger_acta(),
  public.asignaciones_proteger_cascada(),public.asignaciones_papelera_listar(),public.asignaciones_papelera_cambiar(uuid,text),
  public.asignaciones_papelera_vaciar(uuid[]),public.asignaciones_papelera_cerrar_limpieza(text[]) from public,anon;
grant execute on function public.asignaciones_acta_visible(uuid),public.asignaciones_acta_vacia(uuid),
  public.asignaciones_adjunto_libre(text),public.asignaciones_papelera_listar(),public.asignaciones_papelera_cambiar(uuid,text),
  public.asignaciones_papelera_vaciar(uuid[]),public.asignaciones_papelera_cerrar_limpieza(text[]) to authenticated;

commit;
