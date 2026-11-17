-- ============================================================
-- Módulo: inventario
-- Archivo: papelera-inventario-detalle-2026-11-16.sql
-- Estado: APLICADO EN PRODUCCIÓN
-- ============================================================

begin;

alter table public.casiterita_detalle add column if not exists eliminado_en timestamptz,
  add column if not exists eliminado_por uuid, add column if not exists eliminado_motivo text,
  add column if not exists papelera_producto_id uuid, add column if not exists papelera_stock_kg numeric;
revoke delete on public.casiterita_detalle from authenticated,anon;
drop policy if exists inventario_detalle_papelera_select on public.casiterita_detalle;
create policy inventario_detalle_papelera_select on public.casiterita_detalle as restrictive for select to authenticated using(eliminado_en is null);
drop policy if exists inventario_detalle_papelera_insert on public.casiterita_detalle;
create policy inventario_detalle_papelera_insert on public.casiterita_detalle as restrictive for insert to authenticated
  with check(eliminado_en is null and eliminado_por is null and eliminado_motivo is null and papelera_producto_id is null and papelera_stock_kg is null);
drop policy if exists inventario_detalle_papelera_update on public.casiterita_detalle;
create policy inventario_detalle_papelera_update on public.casiterita_detalle as restrictive for update to authenticated
  using(eliminado_en is null)
  with check(eliminado_en is null and eliminado_por is null and eliminado_motivo is null and papelera_producto_id is null and papelera_stock_kg is null);

create or replace function public.inventario_detalle_guardar_consumo()
returns trigger language plpgsql security definer set search_path='' as $$
declare bag jsonb;
begin
  for bag in select distinct v from jsonb_array_elements(coalesce(new.datos->'big_bags','[]'::jsonb)) v
    where nullif(v->>'origen_detalle_id','') is not null order by v loop
    if tg_op='UPDATE' and coalesce(old.datos->'big_bags','[]'::jsonb) @> jsonb_build_array(bag) then continue; end if;
    perform 1 from public.casiterita_detalle where id=(bag->>'origen_detalle_id')::uuid and eliminado_en is null for update;
    if not found then raise exception 'Un big bag de la colada está en la papelera o ya no existe.'; end if;
  end loop;
  return new;
end;
$$;
revoke execute on function public.inventario_detalle_guardar_consumo() from public,anon,authenticated;
drop trigger if exists inventario_detalle_guardar_consumo on public.produccion_colada;
create trigger inventario_detalle_guardar_consumo before insert or update of datos on public.produccion_colada
  for each row execute function public.inventario_detalle_guardar_consumo();

create or replace function public.inventario_detalle_papelera_cambiar(p_id uuid,p_motivo text default null)
returns void language plpgsql security definer set search_path='' as $$
declare f public.casiterita_detalle%rowtype; producto uuid; ubicacion text;
  delta numeric; antes numeric; costo numeric; total numeric; precio_nuevo numeric; correo text; usuario_nombre text;
begin
  if not public.casiterita_puede_escribir() then raise exception 'Se requiere escritura en Inventario' using errcode='42501'; end if;
  if p_motivo is not null and char_length(trim(p_motivo)) not between 5 and 500 then
    raise exception 'Indica un motivo de 5 a 500 caracteres' using errcode='22023';
  end if;
  select * into f from public.casiterita_detalle where id=p_id for update;
  if not found or (f.eliminado_en is null)<>(p_motivo is not null) then
    raise exception 'La entrada cambió de estado. Actualiza la lista.';
  end if;
  if p_motivo is not null then
    if exists(select 1 from public.produccion_colada c cross join lateral
        jsonb_array_elements(coalesce(c.datos->'big_bags','[]'::jsonb)) bag
        where bag->>'origen_detalle_id'=p_id::text) then
      raise exception 'La entrada está vinculada a una colada.';
    end if;
    select id into producto from public.productos where sku='MIN-CASITERITA' order by id limit 1 for update;
    delta:=-greatest(coalesce(f.stock_kg,0),0);
  else
    producto:=f.papelera_producto_id;
    delta:=f.papelera_stock_kg;
    if producto is not null then
      perform 1 from public.productos where id=producto for update;
      if not found then raise exception 'El producto de casiterita ya no existe.'; end if;
    end if;
  end if;
  ubicacion:=coalesce(nullif(trim(f.almacen),''),'SNO₂ CASITERITA ALMACEN');
  if producto is not null and delta<>0 then
    insert into public.existencias(producto_id,almacen) values(producto,ubicacion) on conflict do nothing;
    select stock,costo_promedio into antes,costo from public.existencias
      where producto_id=producto and almacen=ubicacion for update;
    if antes+delta<0 then raise exception 'No hay stock suficiente para archivar esta entrada.'; end if;
    select email,nombre into correo,usuario_nombre from public.usuarios where id=auth.uid();
    insert into public.movimientos(producto_id,almacen,tipo,delta,stock_antes,stock_despues,actor,actor_name,ref_tipo,ref_id,detalle,costo_promedio)
      values(producto,ubicacion,case when delta>0 then 'entrada'::public.tipo_movimiento else 'salida'::public.tipo_movimiento end,
        delta,antes,antes+delta,coalesce(correo,auth.uid()::text),usuario_nombre,'casiterita_detalle_papelera',f.id::text,
        concat_ws(' · ',case when delta>0 then 'Entrada recuperada' else 'Entrada archivada' end,f.procedencia,f.precinto),costo);
    update public.existencias set stock=antes+delta,updated_at=now() where producto_id=producto and almacen=ubicacion;
    select coalesce(sum(stock),0),round(sum(stock*costo_promedio) filter(where costo_promedio>0)
      /nullif(sum(stock) filter(where costo_promedio>0),0),2)
      into total,precio_nuevo from public.existencias where producto_id=producto;
    update public.productos p set stock=total,precio=coalesce(precio_nuevo,p.precio) where id=producto;
  end if;
  update public.casiterita_detalle set eliminado_en=case when p_motivo is not null then now() end,
    eliminado_por=case when p_motivo is not null then auth.uid() end,eliminado_motivo=trim(p_motivo),
    papelera_producto_id=case when p_motivo is not null and delta<>0 then producto end,
    papelera_stock_kg=case when p_motivo is not null and producto is not null and delta<>0 then -delta end
  where id=p_id;
end;
$$;

create or replace function public.inventario_detalle_papelera_listar()
returns table(id text,titulo text,eliminado_en timestamptz,eliminado_motivo text)
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.puede_modulo('inventario','lectura') then raise exception 'Se requiere lectura en Inventario' using errcode='42501'; end if;
  return query select f.id::text,concat_ws(' · ',f.procedencia,f.precinto),f.eliminado_en,f.eliminado_motivo
    from public.casiterita_detalle f where f.eliminado_en is not null order by f.eliminado_en desc,f.id;
end;
$$;

create or replace function public.inventario_detalle_papelera_vaciar(p_ids uuid[])
returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  if not public.puede_vaciar_papelera('inventario') or not public.casiterita_puede_escribir() then
    raise exception 'Falta el permiso Vaciar papelera en Inventario' using errcode='42501';
  end if;
  delete from public.casiterita_detalle where id=any(p_ids) and eliminado_en is not null;
  get diagnostics n=row_count;
  return n;
end;
$$;
revoke execute on function public.inventario_detalle_papelera_listar(),public.inventario_detalle_papelera_cambiar(uuid,text),
  public.inventario_detalle_papelera_vaciar(uuid[]) from public,anon;
grant execute on function public.inventario_detalle_papelera_listar(),public.inventario_detalle_papelera_cambiar(uuid,text),
  public.inventario_detalle_papelera_vaciar(uuid[]) to authenticated;
commit;
