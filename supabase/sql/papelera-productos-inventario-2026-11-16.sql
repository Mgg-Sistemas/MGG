begin;

alter table public.productos
  add column if not exists papelera_vaciada_en timestamptz,
  add column if not exists papelera_vaciada_por uuid;

create or replace function public.productos_proteger_papelera()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE' and old.estado='inactivo' and new.espacio is distinct from old.espacio then
    raise exception 'Recupera el producto antes de cambiarlo de módulo.' using errcode='42501';
  end if;
  if tg_op='UPDATE' and old.papelera_vaciada_en is not null
     and (new.estado is distinct from old.estado or new.stock is distinct from old.stock
       or new.papelera_vaciada_en is distinct from old.papelera_vaciada_en
       or new.papelera_vaciada_por is distinct from old.papelera_vaciada_por) then
    raise exception 'El producto fue retirado definitivamente de la papelera.' using errcode='42501';
  end if;
  if current_user in ('authenticated','anon') then
    if tg_op='INSERT' then
      if new.papelera_vaciada_en is not null or new.papelera_vaciada_por is not null then
        raise exception 'El vaciado debe realizarse desde la papelera.' using errcode='42501';
      end if;
    elsif new.papelera_vaciada_en is distinct from old.papelera_vaciada_en
       or new.papelera_vaciada_por is distinct from old.papelera_vaciada_por then
      raise exception 'El vaciado debe realizarse desde la papelera.' using errcode='42501';
    elsif new.estado is distinct from old.estado and (new.estado='inactivo' or old.estado='inactivo')
       and not public.puede_modulo(case when old.espacio='deposito' or new.espacio='deposito' then 'deposito' else 'inventario' end,'escritura') then
      raise exception 'Se requiere escritura en el módulo del producto.' using errcode='42501';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists productos_proteger_papelera on public.productos;
create trigger productos_proteger_papelera before insert or update on public.productos
  for each row execute function public.productos_proteger_papelera();

create or replace function public.productos_papelera_proteger_stock()
returns trigger language plpgsql security definer set search_path='' as $$
declare vaciado timestamptz;
begin
  if tg_table_name='existencias' then
    if new.stock=0 then return new; end if;
  end if;
  select papelera_vaciada_en into vaciado from public.productos where id=new.producto_id for share;
  if vaciado is not null then
    raise exception 'El producto fue retirado definitivamente de la papelera.' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.productos_papelera_proteger_stock() from public,anon,authenticated;
drop trigger if exists productos_papelera_proteger_movimientos on public.movimientos;
create trigger productos_papelera_proteger_movimientos before insert on public.movimientos
  for each row execute function public.productos_papelera_proteger_stock();
drop trigger if exists productos_papelera_proteger_existencias on public.existencias;
create trigger productos_papelera_proteger_existencias before insert or update of producto_id,stock on public.existencias
  for each row execute function public.productos_papelera_proteger_stock();

create or replace function public.productos_papelera_recuperar(p_modulo text,p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_modulo is null or p_modulo not in ('inventario','deposito') or not public.puede_modulo(p_modulo,'escritura') then
    raise exception 'Se requiere escritura en el módulo del producto.' using errcode='42501';
  end if;
  update public.productos set estado='activo',desactivado_en=null,desactivado_por=null,desactivado_motivo=null,updated_at=now()
    where id=p_id and estado='inactivo' and papelera_vaciada_en is null
      and (espacio='deposito')=(p_modulo='deposito');
  if not found then raise exception 'El producto ya no está en la papelera del módulo.'; end if;
end;
$$;

create or replace function public.productos_papelera_vaciar(p_modulo text,p_ids uuid[])
returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  if p_modulo is null or p_modulo not in ('inventario','deposito') or not public.puede_vaciar_papelera(p_modulo) then
    raise exception 'Falta el permiso Vaciar papelera en el módulo del producto.' using errcode='42501';
  end if;
  perform 1 from public.productos where id=any(p_ids) and estado='inactivo' and papelera_vaciada_en is null
    and (espacio='deposito')=(p_modulo='deposito') order by id for update;
  if exists(select 1 from public.productos p where p.id=any(p_ids) and p.estado='inactivo' and p.papelera_vaciada_en is null
    and (p.espacio='deposito')=(p_modulo='deposito')
    and (p.stock<>0 or exists(select 1 from public.existencias e where e.producto_id=p.id and e.stock<>0))) then
    raise exception 'Hay productos con stock. Recupéralos y regulariza sus existencias antes de vaciar.';
  end if;
  update public.productos set papelera_vaciada_en=now(),papelera_vaciada_por=auth.uid()
    where id=any(p_ids) and estado='inactivo' and papelera_vaciada_en is null
      and (espacio='deposito')=(p_modulo='deposito');
  get diagnostics n=row_count;
  return n;
end;
$$;
revoke execute on function public.productos_papelera_recuperar(text,uuid),public.productos_papelera_vaciar(text,uuid[]) from public,anon;
grant execute on function public.productos_papelera_recuperar(text,uuid),public.productos_papelera_vaciar(text,uuid[]) to authenticated;

update public.roles_permisos set permisos=jsonb_set(permisos,'{inventario}',
  coalesce(permisos->'inventario','{}'::jsonb)||'{"vaciar_papelera":true}'::jsonb,true) where role='admin';
commit;
