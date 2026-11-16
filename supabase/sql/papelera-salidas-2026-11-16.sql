begin;

do $$
declare t text;
begin
  foreach t in array array['solicitudes_salida_temporal','salidas_choferes','salidas_vehiculos'] loop
    execute format('alter table public.%I add column if not exists eliminado_en timestamptz,
      add column if not exists eliminado_por uuid, add column if not exists eliminado_motivo text',t);
    execute format('revoke delete on public.%I from authenticated, anon',t);
    execute format('drop policy if exists papelera_activos on public.%I',t);
    execute format('create policy papelera_activos on public.%I as restrictive for select to authenticated using(eliminado_en is null)',t);
    execute format('drop policy if exists papelera_update on public.%I',t);
    execute format('create policy papelera_update on public.%I as restrictive for update to authenticated
      using(eliminado_en is null) with check(eliminado_en is null and eliminado_por is null and eliminado_motivo is null)',t);
    execute format('drop policy if exists papelera_insert on public.%I',t);
    execute format('create policy papelera_insert on public.%I as restrictive for insert to authenticated
      with check(eliminado_en is null and eliminado_por is null and eliminado_motivo is null)',t);
  end loop;
end;
$$;

create table if not exists public.salidas_adjuntos_por_vaciar (ruta text primary key);
alter table public.salidas_adjuntos_por_vaciar enable row level security;
revoke all on public.salidas_adjuntos_por_vaciar from public, anon, authenticated;
grant select on public.salidas_adjuntos_por_vaciar to authenticated;
drop policy if exists salidas_limpieza_lectura on public.salidas_adjuntos_por_vaciar;
create policy salidas_limpieza_lectura on public.salidas_adjuntos_por_vaciar for select to authenticated
  using ((select public.puede_vaciar_papelera('salidas')));

create or replace function public.salidas_papelera_cambiar(p_tabla text,p_id uuid,p_motivo text default null)
returns void language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  if not public.puede_modulo('salidas','escritura') then
    raise exception 'Se requiere escritura en Salidas' using errcode='42501';
  end if;
  if p_tabla is null or p_tabla not in ('solicitudes_salida_temporal','salidas_choferes','salidas_vehiculos') then
    raise exception 'Tipo de registro inválido' using errcode='22023';
  end if;
  if p_motivo is null then
    execute format('update public.%I set eliminado_en=null,eliminado_por=null,eliminado_motivo=null
      where id=$1 and eliminado_en is not null',p_tabla) using p_id;
  else
    if char_length(trim(p_motivo)) not between 5 and 500 then
      raise exception 'Indica un motivo de 5 a 500 caracteres' using errcode='22023';
    end if;
    if p_tabla='solicitudes_salida_temporal' then
      perform 1 from public.solicitudes_salida_temporal where id=p_id for update;
      if exists(select 1 from public.movimientos m join public.solicitudes_salida_temporal s
        on m.ref_codigo=s.codigo where s.id=p_id and m.ref_tipo='salida_temporal') then
        raise exception 'La solicitud ya tiene movimientos de inventario.';
      end if;
    end if;
    execute format('update public.%I set eliminado_en=now(),eliminado_por=auth.uid(),eliminado_motivo=trim($2)
      where id=$1 and eliminado_en is null%s',p_tabla,
      case when p_tabla='solicitudes_salida_temporal' then ' and estado=''por_aprobar''' else '' end)
      using p_id,p_motivo;
  end if;
  get diagnostics n=row_count;
  if n=0 then raise exception 'El registro cambió de estado. Actualiza la lista.'; end if;
end;
$$;

create or replace function public.salidas_temporales_guardar_movimiento()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.ref_tipo='salida_temporal' then
    perform 1 from public.solicitudes_salida_temporal s
      where s.codigo=new.ref_codigo and s.eliminado_en is null for update;
    if not found then
      raise exception 'La salida temporal está en la papelera o ya no existe.';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.salidas_temporales_guardar_movimiento() from public,anon,authenticated;
drop trigger if exists salidas_temporales_proteger_movimiento on public.movimientos;
create trigger salidas_temporales_proteger_movimiento before insert on public.movimientos
  for each row when (new.ref_tipo='salida_temporal') execute function public.salidas_temporales_guardar_movimiento();

create or replace function public.salidas_papelera_listar()
returns table(id text,titulo text,eliminado_en timestamptz,eliminado_motivo text)
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.puede_modulo('salidas','lectura') then
    raise exception 'Se requiere lectura en Salidas' using errcode='42501';
  end if;
  return query select * from (
    select 'solicitudes_salida_temporal:'||s.id,'Salida temporal · '||s.codigo,s.eliminado_en,s.eliminado_motivo
      from public.solicitudes_salida_temporal s where s.eliminado_en is not null
    union all select 'salidas_choferes:'||c.id,'Chofer · '||c.nombre,c.eliminado_en,c.eliminado_motivo
      from public.salidas_choferes c where c.eliminado_en is not null
    union all select 'salidas_vehiculos:'||v.id,'Vehículo · '||v.nombre,v.eliminado_en,v.eliminado_motivo
      from public.salidas_vehiculos v where v.eliminado_en is not null
  ) r(i,t,e,m) order by r.e desc,r.i;
end;
$$;

create or replace function public.salidas_papelera_vaciar(p_ids text[])
returns integer language plpgsql security definer set search_path='' as $$
declare t text; ids uuid[]; n integer; total integer:=0;
begin
  if not public.puede_vaciar_papelera('salidas') then
    raise exception 'Falta el permiso Vaciar papelera en Salidas' using errcode='42501';
  end if;
  foreach t in array array['solicitudes_salida_temporal','salidas_choferes','salidas_vehiculos'] loop
    select array_agg(split_part(i,':',2)::uuid) into ids from unnest(p_ids) i where split_part(i,':',1)=t;
    if ids is null then continue; end if;
    if t='solicitudes_salida_temporal' then
      perform 1 from public.solicitudes_salida_temporal where id=any(ids) and eliminado_en is not null for update;
      insert into public.salidas_adjuntos_por_vaciar(ruta)
      select a->>'path' from public.solicitudes_salida_temporal s cross join lateral jsonb_array_elements(s.adjuntos) a
        where s.id=any(ids) and s.eliminado_en is not null and a->>'path' like s.id::text||'/%'
        on conflict do nothing;
    end if;
    execute format('delete from public.%I where id=any($1) and eliminado_en is not null',t) using ids;
    get diagnostics n=row_count;
    total:=total+n;
  end loop;
  return total;
end;
$$;

create or replace function public.salidas_adjunto_referenciado(p_ruta text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.solicitudes_salida_temporal s where
    split_part(p_ruta,'/',1)=s.id::text and s.adjuntos @> jsonb_build_array(jsonb_build_object('path',p_ruta)))
    or exists(select 1 from public.solicitudes_salida s where
    split_part(p_ruta,'/',1)=s.id::text and s.adjuntos @> jsonb_build_array(jsonb_build_object('path',p_ruta)));
$$;

create or replace function public.salidas_papelera_adjunto_libre(p_ruta text)
returns boolean language sql stable security definer set search_path='' as $$
  select not public.salidas_adjunto_referenciado(p_ruta)
    and (public.puede_vaciar_papelera('salidas') or not exists(
       select 1 from public.salidas_adjuntos_por_vaciar where ruta=p_ruta));
$$;

create or replace function public.salidas_papelera_cerrar_limpieza(p_rutas text[])
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.puede_vaciar_papelera('salidas') then
    raise exception 'Falta el permiso Vaciar papelera en Salidas' using errcode='42501';
  end if;
  delete from public.salidas_adjuntos_por_vaciar q where q.ruta=any(p_rutas)
    and (public.salidas_adjunto_referenciado(q.ruta)
      or not exists(select 1 from storage.objects where bucket_id='salidas-adjuntos' and name=q.ruta));
end;
$$;

drop policy if exists salidas_papelera_storage_delete on storage.objects;
create policy salidas_papelera_storage_delete on storage.objects as restrictive for delete to authenticated
  using (bucket_id<>'salidas-adjuntos' or public.salidas_papelera_adjunto_libre(name));
drop policy if exists salidas_papelera_storage_update on storage.objects;
create policy salidas_papelera_storage_update on storage.objects as restrictive for update to authenticated
  using (bucket_id<>'salidas-adjuntos' or public.salidas_papelera_adjunto_libre(name))
  with check (bucket_id<>'salidas-adjuntos' or public.salidas_papelera_adjunto_libre(name));

revoke execute on function public.salidas_adjunto_referenciado(text),public.salidas_papelera_adjunto_libre(text),
  public.salidas_papelera_listar(),public.salidas_papelera_vaciar(text[]),public.salidas_papelera_cambiar(text,uuid,text),
  public.salidas_papelera_cerrar_limpieza(text[]) from public,anon;
grant execute on function public.salidas_papelera_adjunto_libre(text),public.salidas_papelera_listar(),
  public.salidas_papelera_vaciar(text[]),public.salidas_papelera_cambiar(text,uuid,text),
  public.salidas_papelera_cerrar_limpieza(text[]) to authenticated;

update public.roles_permisos set permisos=jsonb_set(permisos,'{salidas}',
  coalesce(permisos->'salidas','{}'::jsonb)||'{"vaciar_papelera":true}'::jsonb,true) where role='admin';

commit;
