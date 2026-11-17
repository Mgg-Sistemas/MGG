-- ============================================================
-- Módulo: inventario
-- Archivo: papelera-almacenes-2026-11-16.sql
-- Estado: APLICADO EN PRODUCCIÓN
-- ============================================================

begin;

alter table public.almacenes add column if not exists eliminado_en timestamptz,
  add column if not exists eliminado_por uuid, add column if not exists eliminado_motivo text,
  add column if not exists papelera_existencias jsonb, add column if not exists papelera_destino text,
  add column if not exists papelera_productos uuid[];
revoke delete on public.almacenes from authenticated,anon;
drop policy if exists almacenes_papelera_select on public.almacenes;
create policy almacenes_papelera_select on public.almacenes as restrictive for select to authenticated using(eliminado_en is null);
drop policy if exists almacenes_papelera_insert on public.almacenes;
create policy almacenes_papelera_insert on public.almacenes as restrictive for insert to authenticated
  with check(eliminado_en is null and eliminado_por is null and eliminado_motivo is null
    and papelera_existencias is null and papelera_destino is null and papelera_productos is null);
drop policy if exists almacenes_papelera_update on public.almacenes;
create policy almacenes_papelera_update on public.almacenes as restrictive for update to authenticated
  using(eliminado_en is null) with check(eliminado_en is null and eliminado_por is null and eliminado_motivo is null
    and papelera_existencias is null and papelera_destino is null and papelera_productos is null);

create or replace function public.almacenes_papelera_guardar_existencia()
returns trigger language plpgsql security definer set search_path='' as $$
declare archivado timestamptz;
begin
  select eliminado_en into archivado from public.almacenes where nombre=new.almacen for share;
  if archivado is not null then raise exception 'El almacén de la existencia está en la papelera.'; end if;
  return new;
end;
$$;
revoke execute on function public.almacenes_papelera_guardar_existencia() from public,anon,authenticated;
drop trigger if exists almacenes_papelera_guardar_existencia on public.existencias;
create trigger almacenes_papelera_guardar_existencia before insert or update of almacen,stock on public.existencias
  for each row execute function public.almacenes_papelera_guardar_existencia();
drop trigger if exists almacenes_papelera_guardar_ubicacion on public.productos;
create trigger almacenes_papelera_guardar_ubicacion before insert or update of almacen on public.productos
  for each row execute function public.almacenes_papelera_guardar_existencia();

create or replace function public.almacenes_papelera_cambiar(p_id uuid,p_motivo text default null,p_destino text default null)
returns void language plpgsql security definer set search_path='' as $$
declare a public.almacenes%rowtype; modulo text; productos uuid[]; filas jsonb; destino text:=nullif(trim(p_destino),'');
begin
  select * into a from public.almacenes where id=p_id for update;
  if not found then raise exception 'El almacén ya no existe.'; end if;
  modulo:=case when a.espacio='deposito' then 'deposito' else 'inventario' end;
  if not public.puede_modulo(modulo,'escritura') then raise exception 'Se requiere escritura en el módulo del almacén' using errcode='42501'; end if;
  if (a.eliminado_en is null)<>(p_motivo is not null) then raise exception 'El almacén cambió de estado.'; end if;
  if p_motivo is null then
    if a.parent_id is not null and not exists(select 1 from public.almacenes p where p.id=a.parent_id and p.eliminado_en is null) then
      raise exception 'Recupera primero el almacén superior.';
    end if;
    update public.almacenes set eliminado_en=null,eliminado_por=null,eliminado_motivo=null,
      papelera_existencias=null,papelera_destino=null,papelera_productos=null where id=p_id;
    insert into public.existencias
      select (jsonb_populate_record(null::public.existencias,e)).* from jsonb_array_elements(coalesce(a.papelera_existencias,'[]'::jsonb)) e
      where exists(select 1 from public.productos where id=(e->>'producto_id')::uuid)
      on conflict(producto_id,almacen) do nothing;
    update public.productos set almacen=a.nombre,updated_at=now()
      where id=any(a.papelera_productos) and almacen=a.papelera_destino and updated_at=a.eliminado_en;
    return;
  end if;
  if char_length(trim(p_motivo)) not between 5 and 500 then raise exception 'Indica un motivo de 5 a 500 caracteres' using errcode='22023'; end if;
  if exists(select 1 from public.almacenes where parent_id=p_id and eliminado_en is null) then
    raise exception 'Reasigna o archiva primero los subalmacenes.';
  end if;
  if exists(select 1 from public.existencias where almacen=a.nombre and stock<>0) then
    raise exception 'El almacén tiene stock pendiente. Traslada sus existencias antes de archivar.';
  end if;
  if exists(select 1 from public.cocinas where almacen_id=p_id) then
    raise exception 'Hay una cocina vinculada. Asigna otro almacén antes de archivar.';
  end if;
  if exists(select 1 from public.productos where almacen=a.nombre) then
    if destino is null or not exists(select 1 from public.almacenes o
      where o.nombre=destino and o.id<>a.id and o.espacio=a.espacio and o.eliminado_en is null) then
      raise exception 'Elige un almacén activo para reasignar los productos.';
    end if;
    with reasignados as (update public.productos set almacen=destino,updated_at=now()
      where almacen=a.nombre returning id) select array_agg(id) into productos from reasignados;
  end if;
  with archivadas as (delete from public.existencias where almacen=a.nombre and stock=0 returning *)
    select jsonb_agg(to_jsonb(archivadas)) into filas from archivadas;
  update public.almacenes set eliminado_en=now(),eliminado_por=auth.uid(),eliminado_motivo=trim(p_motivo),
    papelera_existencias=filas,papelera_destino=destino,papelera_productos=productos where id=p_id;
end;
$$;

create or replace function public.almacenes_papelera_listar(p_modulo text)
returns table(id text,titulo text,eliminado_en timestamptz,eliminado_motivo text)
language plpgsql stable security definer set search_path='' as $$
begin
  if p_modulo is null or p_modulo not in ('inventario','deposito') or not public.puede_modulo(p_modulo,'lectura') then
    raise exception 'Se requiere lectura en el módulo del almacén' using errcode='42501';
  end if;
  return query select a.id::text,concat_ws(' · ',a.sede,a.nombre),a.eliminado_en,a.eliminado_motivo from public.almacenes a
    where a.eliminado_en is not null and (a.espacio='deposito')=(p_modulo='deposito') order by a.eliminado_en desc,a.id;
end;
$$;

create or replace function public.almacenes_papelera_vaciar(p_modulo text,p_ids uuid[])
returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  if p_modulo is null or p_modulo not in ('inventario','deposito') or not public.puede_vaciar_papelera(p_modulo) then
    raise exception 'Falta el permiso Vaciar papelera en el módulo del almacén' using errcode='42501';
  end if;
  if exists(select 1 from public.almacenes a join public.almacenes h on h.parent_id=a.id
    where a.id=any(p_ids) and a.eliminado_en is not null and (a.espacio='deposito')=(p_modulo='deposito')
      and (h.eliminado_en is null or not h.id=any(p_ids) or h.espacio<>a.espacio)) then
    raise exception 'Incluye los subalmacenes archivados para vaciar su almacén superior.';
  end if;
  delete from public.almacenes a where id=any(p_ids) and a.eliminado_en is not null and (a.espacio='deposito')=(p_modulo='deposito');
  get diagnostics n=row_count;
  return n;
end;
$$;
revoke execute on function public.almacenes_papelera_listar(text),public.almacenes_papelera_cambiar(uuid,text,text),
  public.almacenes_papelera_vaciar(text,uuid[]) from public,anon;
grant execute on function public.almacenes_papelera_listar(text),public.almacenes_papelera_cambiar(uuid,text,text),
  public.almacenes_papelera_vaciar(text,uuid[]) to authenticated;
update public.roles_permisos set permisos=jsonb_set(permisos,'{deposito}',
  coalesce(permisos->'deposito','{}'::jsonb)||'{"vaciar_papelera":true}'::jsonb,true) where role='admin';
commit;
