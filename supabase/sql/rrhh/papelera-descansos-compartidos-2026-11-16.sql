-- ============================================================
-- Módulo: rrhh
-- Archivo: papelera-descansos-compartidos-2026-11-16.sql
-- Estado: APLICADO EN PRODUCCIÓN
-- ============================================================

begin;

do $$
declare t text;
begin
  foreach t in array array['rrhh_descansos','rrhh_descansos_grupos'] loop
    execute format('alter table public.%I add column if not exists eliminado_en timestamptz,
      add column if not exists eliminado_por uuid, add column if not exists eliminado_motivo text,
      add column if not exists eliminado_modulo text',t);
    execute format('revoke delete on public.%I from authenticated, anon',t);
    execute format('drop policy if exists descanso_papelera_delete on public.%I',t);
    execute format('create policy descanso_papelera_delete on public.%I as restrictive for delete to authenticated using(false)',t);
    execute format('drop policy if exists descanso_papelera_select on public.%I',t);
    execute format('create policy descanso_papelera_select on public.%I as restrictive for select to authenticated using(eliminado_en is null)',t);
    execute format('drop policy if exists descanso_papelera_insert on public.%I',t);
    execute format('create policy descanso_papelera_insert on public.%I as restrictive for insert to authenticated
      with check(eliminado_en is null and eliminado_por is null and eliminado_motivo is null and eliminado_modulo is null)',t);
    execute format('drop policy if exists descanso_papelera_update on public.%I',t);
    execute format('create policy descanso_papelera_update on public.%I as restrictive for update to authenticated
      using(eliminado_en is null)
      with check(eliminado_en is null and eliminado_por is null and eliminado_motivo is null and eliminado_modulo is null)',t);
  end loop;
end;
$$;

create or replace function public.rrhh_descansos_sin_solape()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('rrhh/descanso/'||new.personal_id,0));
  if new.eliminado_en is null and exists (
    select 1 from public.rrhh_descansos d
     where d.personal_id=new.personal_id and d.id is distinct from new.id and d.eliminado_en is null
       and d.desde<=new.hasta and new.desde<=d.hasta
  ) then
    raise exception 'Esa persona ya tiene un descanso cargado en esas fechas.';
  end if;
  return new;
end;
$$;

create or replace function public.rrhh_descansos_aplicar_plan(
  p_personal_ids uuid[],p_desde date,p_filas jsonb,p_actor text default null,p_actor_name text default null
)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  if not public.is_staff() then raise exception 'No tenés permiso para aplicar el plan de descansos.'; end if;
  delete from public.rrhh_descansos d
    where d.personal_id=any(p_personal_ids) and d.origen='plan' and d.desde>=p_desde and d.eliminado_en is null;
  insert into public.rrhh_descansos(personal_id,desde,hasta,origen,created_by,actor_name)
    select (f->>'personal_id')::uuid,(f->>'desde')::date,(f->>'hasta')::date,'plan',p_actor,p_actor_name
    from jsonb_array_elements(coalesce(p_filas,'[]'::jsonb)) f;
  get diagnostics v_n=row_count;
  return v_n;
end;
$$;

create or replace function public.rrhh_descanso_evitar_cascada()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.eliminado_en is not null and pg_trigger_depth()>1 then
    raise exception 'La ficha tiene un descanso en la papelera.';
  end if;
  return old;
end;
$$;
revoke execute on function public.rrhh_descanso_evitar_cascada() from public,anon,authenticated;
drop trigger if exists rrhh_descanso_evitar_cascada on public.rrhh_descansos;
create trigger rrhh_descanso_evitar_cascada before delete on public.rrhh_descansos
  for each row execute function public.rrhh_descanso_evitar_cascada();

create or replace function public.descanso_papelera_cambiar(p_modulo text,p_tabla text,p_id uuid,p_motivo text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if p_modulo is null or p_modulo not in ('rrhh','choferes') or not public.puede_modulo(p_modulo,'escritura') then
    raise exception 'Se requiere escritura en el módulo de origen' using errcode='42501';
  end if;
  if p_tabla is null or p_tabla not in ('rrhh_descansos','rrhh_descansos_grupos') then
    raise exception 'Tipo de registro inválido' using errcode='22023';
  end if;
  if p_motivo is null then
    execute format('update public.%I set eliminado_en=null,eliminado_por=null,eliminado_motivo=null,eliminado_modulo=null
      where id=$1 and eliminado_en is not null and eliminado_modulo=$2',p_tabla) using p_id,p_modulo;
  else
    if char_length(trim(p_motivo)) not between 5 and 500 then
      raise exception 'Indica un motivo de 5 a 500 caracteres' using errcode='22023';
    end if;
    execute format('update public.%I set eliminado_en=now(),eliminado_por=auth.uid(),eliminado_motivo=trim($3),eliminado_modulo=$2
       where id=$1 and eliminado_en is null%s',p_tabla,
       case when p_tabla='rrhh_descansos_grupos' then ' and (empresa=''MGG·choferes'')=($2=''choferes'')'
       when p_modulo='choferes' then ' and exists(select 1 from public.choferes_conductores c
         where c.personal_id=rrhh_descansos.personal_id and c.eliminado_en is null)'
       else '' end)
    using p_id,p_modulo,p_motivo;
  end if;
  get diagnostics n=row_count;
  if n=0 then raise exception 'El estado del registro cambió. Actualiza la lista.'; end if;
end;
$$;

create or replace function public.descanso_papelera_listar(p_modulo text)
returns table(id text,titulo text,eliminado_en timestamptz,eliminado_motivo text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_modulo is null or p_modulo not in ('rrhh','choferes') or not public.puede_modulo(p_modulo,'lectura') then
    raise exception 'Se requiere lectura en el módulo de origen' using errcode='42501';
  end if;
  return query select * from (
    select 'rrhh_descansos:'||d.id,concat_ws(' · ',concat_ws(' ',p.nombre,p.apellido),d.desde||' a '||d.hasta),d.eliminado_en,d.eliminado_motivo
      from public.rrhh_descansos d join public.personal p on p.id=d.personal_id
      where d.eliminado_en is not null and d.eliminado_modulo=p_modulo
    union all
    select 'rrhh_descansos_grupos:'||g.id,'Selección · '||g.nombre,g.eliminado_en,g.eliminado_motivo
      from public.rrhh_descansos_grupos g where g.eliminado_en is not null and g.eliminado_modulo=p_modulo
  ) r(i,t,e,m) order by r.e desc,r.i;
end;
$$;

create or replace function public.descanso_vaciar_papelera(p_modulo text,p_ids text[])
returns integer language plpgsql security definer set search_path = '' as $$
declare t text; ids uuid[]; n integer; total integer:=0;
begin
  if p_modulo is null or p_modulo not in ('rrhh','choferes') or not public.puede_vaciar_papelera(p_modulo) then
    raise exception 'Falta el permiso Vaciar papelera en el módulo de origen' using errcode='42501';
  end if;
  foreach t in array array['rrhh_descansos','rrhh_descansos_grupos'] loop
    select array_agg(split_part(i,':',2)::uuid) into ids from unnest(p_ids) i where split_part(i,':',1)=t;
    if ids is null then continue; end if;
    execute format('delete from public.%I where id=any($1) and eliminado_en is not null and eliminado_modulo=$2',t)
      using ids,p_modulo;
    get diagnostics n=row_count;
    total:=total+n;
  end loop;
  return total;
end;
$$;
revoke execute on function public.descanso_papelera_listar(text), public.descanso_papelera_cambiar(text,text,uuid,text),
  public.descanso_vaciar_papelera(text,text[]) from public,anon;
grant execute on function public.descanso_papelera_listar(text), public.descanso_papelera_cambiar(text,text,uuid,text),
  public.descanso_vaciar_papelera(text,text[]) to authenticated;

commit;
