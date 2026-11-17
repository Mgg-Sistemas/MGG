-- ============================================================
-- Módulo: tesoreria
-- Archivo: papelera-tesoreria-catalogos-2026-11-16.sql
-- Estado: APLICADO EN PRODUCCIÓN
-- ============================================================

begin;

do $$
declare t text;
begin
  foreach t in array array['categorias_gasto','tesoreria_contrapartes'] loop
    execute format('alter table public.%I add column if not exists eliminado_en timestamptz,
      add column if not exists eliminado_por uuid, add column if not exists eliminado_motivo text',t);
    execute format('revoke delete on public.%I from authenticated,anon',t);
    execute format('drop policy if exists tesoreria_catalogo_papelera_select on public.%I',t);
    execute format('create policy tesoreria_catalogo_papelera_select on public.%I as restrictive for select to authenticated using(eliminado_en is null)',t);
    execute format('drop policy if exists tesoreria_catalogo_papelera_insert on public.%I',t);
    execute format('create policy tesoreria_catalogo_papelera_insert on public.%I as restrictive for insert to authenticated
      with check(eliminado_en is null and eliminado_por is null and eliminado_motivo is null)',t);
    execute format('drop policy if exists tesoreria_catalogo_papelera_update on public.%I',t);
    execute format('create policy tesoreria_catalogo_papelera_update on public.%I as restrictive for update to authenticated
      using(eliminado_en is null) with check(eliminado_en is null and eliminado_por is null and eliminado_motivo is null)',t);
  end loop;
end;
$$;

create or replace function public.tesoreria_categoria_padre_activa(p_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  with recursive ancestros(id,padre_id,eliminado_en) as (
    select id,padre_id,eliminado_en from public.categorias_gasto where id=p_id
    union
    select c.id,c.padre_id,c.eliminado_en from public.categorias_gasto c join ancestros a on c.id=a.padre_id
  ) select not exists(select 1 from ancestros where eliminado_en is not null);
$$;
revoke execute on function public.tesoreria_categoria_padre_activa(uuid) from public,anon;
grant execute on function public.tesoreria_categoria_padre_activa(uuid) to authenticated;

drop policy if exists tesoreria_categoria_padre_select on public.categorias_gasto;
create policy tesoreria_categoria_padre_select on public.categorias_gasto as restrictive for select to authenticated
  using(public.tesoreria_categoria_padre_activa(padre_id));
drop policy if exists tesoreria_categoria_padre_insert on public.categorias_gasto;
create policy tesoreria_categoria_padre_insert on public.categorias_gasto as restrictive for insert to authenticated
  with check(public.tesoreria_categoria_padre_activa(padre_id));
drop policy if exists tesoreria_categoria_padre_update on public.categorias_gasto;
create policy tesoreria_categoria_padre_update on public.categorias_gasto as restrictive for update to authenticated
  using(public.tesoreria_categoria_padre_activa(padre_id)) with check(public.tesoreria_categoria_padre_activa(padre_id));

create or replace function public.tesoreria_catalogo_papelera_cambiar(p_tabla text,p_id uuid,p_motivo text default null)
returns void language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  if not public.puede_modulo('tesoreria','escritura') then
    raise exception 'Se requiere escritura en Tesorería' using errcode='42501';
  end if;
  if p_tabla is null or p_tabla not in ('categorias_gasto','tesoreria_contrapartes') then
    raise exception 'Tipo de registro inválido' using errcode='22023';
  end if;
  if p_tabla='categorias_gasto' and exists(select 1 from public.categorias_gasto where id=p_id and
     not public.tesoreria_categoria_padre_activa(padre_id)) then
    raise exception 'Recupera primero la categoría principal.';
  end if;
  if p_motivo is null then
    execute format('update public.%I set eliminado_en=null,eliminado_por=null,eliminado_motivo=null
      where id=$1 and eliminado_en is not null',p_tabla) using p_id;
  else
    if char_length(trim(p_motivo)) not between 5 and 500 then
      raise exception 'Indica un motivo de 5 a 500 caracteres' using errcode='22023';
    end if;
    execute format('update public.%I set eliminado_en=now(),eliminado_por=auth.uid(),eliminado_motivo=trim($2)
      where id=$1 and eliminado_en is null',p_tabla) using p_id,p_motivo;
  end if;
  get diagnostics n=row_count;
  if n=0 then raise exception 'El estado del registro cambió. Actualiza la lista.'; end if;
end;
$$;

create or replace function public.tesoreria_catalogo_papelera_listar()
returns table(id text,titulo text,eliminado_en timestamptz,eliminado_motivo text)
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.puede_modulo('tesoreria','lectura') then raise exception 'Se requiere lectura en Tesorería' using errcode='42501'; end if;
  return query select * from (
    select 'categorias_gasto:'||c.id,
      concat_ws(' · ',case when c.padre_id is null then 'Categoría' else 'Subcategoría' end,p.nombre,c.nombre),
      c.eliminado_en,c.eliminado_motivo from public.categorias_gasto c
      left join public.categorias_gasto p on p.id=c.padre_id where c.eliminado_en is not null
    union all select 'tesoreria_contrapartes:'||c.id,concat_ws(' · ',initcap(c.tipo),c.nombre),
      c.eliminado_en,c.eliminado_motivo from public.tesoreria_contrapartes c where c.eliminado_en is not null
  ) r(i,t,e,m) order by r.e desc,r.i;
end;
$$;

create or replace function public.tesoreria_catalogo_papelera_vaciar(p_ids text[])
returns integer language plpgsql security definer set search_path='' as $$
declare t text; ids uuid[]; n integer; total integer:=0; d record;
begin
  if not public.puede_vaciar_papelera('tesoreria') then raise exception 'Falta el permiso Vaciar papelera en Tesorería' using errcode='42501'; end if;
  foreach t in array array['categorias_gasto','tesoreria_contrapartes'] loop
    select array_agg(split_part(i,':',2)::uuid) into ids from unnest(p_ids) i where split_part(i,':',1)=t;
    if ids is null then continue; end if;
    if t='categorias_gasto' then
      for d in select id from public.categorias_gasto where id=any(ids) and eliminado_en is not null for update loop
        if exists(with recursive ramas(id,eliminado_en) as (
          select id,eliminado_en from public.categorias_gasto where padre_id=d.id
          union select c.id,c.eliminado_en from public.categorias_gasto c join ramas r on c.padre_id=r.id
        ) select 1 from ramas where eliminado_en is not null and not id=any(ids)) then
          raise exception 'Incluye las subcategorías archivadas por separado para vaciar la categoría.';
        end if;
      end loop;
      select count(*) into n from public.categorias_gasto where id=any(ids) and eliminado_en is not null;
      delete from public.categorias_gasto where id=any(ids) and eliminado_en is not null;
    else
      if exists(select 1 from public.ventas v join public.tesoreria_contrapartes c on c.id=v.cliente_id
        where c.eliminado_en is not null and c.id=any(ids)) then
        raise exception 'El cliente tiene ventas vinculadas. Puedes mantenerlo archivado o recuperarlo.';
      end if;
      delete from public.tesoreria_contrapartes where id=any(ids) and eliminado_en is not null;
      get diagnostics n=row_count;
    end if;
    total:=total+n;
  end loop;
  return total;
end;
$$;
revoke execute on function public.tesoreria_catalogo_papelera_listar(),
  public.tesoreria_catalogo_papelera_cambiar(text,uuid,text),public.tesoreria_catalogo_papelera_vaciar(text[]) from public,anon;
grant execute on function public.tesoreria_catalogo_papelera_listar(),
  public.tesoreria_catalogo_papelera_cambiar(text,uuid,text),public.tesoreria_catalogo_papelera_vaciar(text[]) to authenticated;
commit;
