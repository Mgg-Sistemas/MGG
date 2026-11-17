-- ============================================================
-- Módulo: inventario
-- Archivo: papelera-inventario-pmp-2026-11-16.sql
-- Estado: APLICADO EN PRODUCCIÓN
-- ============================================================

begin;

create table if not exists public.inventario_pmp_papelera (
  id uuid primary key,
  fila jsonb not null,
  eliminado_en timestamptz not null default now(),
  eliminado_por uuid,
  eliminado_motivo text not null
);
alter table public.inventario_pmp_papelera enable row level security;
revoke all on public.inventario_pmp_papelera from public,anon,authenticated;
revoke delete on public.casiterita_libro from authenticated,anon;

create or replace function public.inventario_pmp_id_archivado(p_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.inventario_pmp_papelera where id=p_id);
$$;
revoke execute on function public.inventario_pmp_id_archivado(uuid) from public,anon;
grant execute on function public.inventario_pmp_id_archivado(uuid) to authenticated;
drop policy if exists inventario_pmp_papelera_insert on public.casiterita_libro;
create policy inventario_pmp_papelera_insert on public.casiterita_libro as restrictive for insert to authenticated
  with check(not public.inventario_pmp_id_archivado(id));

create or replace function public.inventario_pmp_restaurar_autoria()
returns trigger language plpgsql security definer set search_path='' as $$
declare f public.casiterita_libro;
begin
  select (jsonb_populate_record(null::public.casiterita_libro,fila)).* into f
    from public.inventario_pmp_papelera where id=new.id;
  if found then
    new.actor:=f.actor;
    new.actor_name:=f.actor_name;
    new.created_at:=f.created_at;
  end if;
  return new;
end;
$$;
revoke execute on function public.inventario_pmp_restaurar_autoria() from public,anon,authenticated;
drop trigger if exists z_inventario_pmp_restaurar_autoria on public.casiterita_libro;
create trigger z_inventario_pmp_restaurar_autoria before insert on public.casiterita_libro
  for each row execute function public.inventario_pmp_restaurar_autoria();

create or replace function public.inventario_pmp_papelera_cambiar(p_id uuid,p_motivo text default null)
returns void language plpgsql security definer set search_path='' as $$
declare f public.casiterita_libro%rowtype; original jsonb;
begin
  if not public.casiterita_puede_escribir() then
    raise exception 'Se requiere escritura en Inventario' using errcode='42501';
  end if;
  if p_motivo is null then
    select fila into original from public.inventario_pmp_papelera where id=p_id for update;
    if not found then raise exception 'El registro ya no está en la papelera.'; end if;
    insert into public.casiterita_libro overriding system value
      select (jsonb_populate_record(null::public.casiterita_libro,original)).*;
    delete from public.inventario_pmp_papelera where id=p_id;
  else
    if char_length(trim(p_motivo)) not between 5 and 500 then
      raise exception 'Indica un motivo de 5 a 500 caracteres' using errcode='22023';
    end if;
    select * into f from public.casiterita_libro where id=p_id for update;
    if not found then raise exception 'El movimiento cambió de estado. Actualiza la lista.'; end if;
    if f.lote_id is not null or f.colada_id is not null or f.cierre_id is not null
      or exists(select 1 from public.casiterita_conteos where ajuste_id=p_id)
      or exists(select 1 from public.casiterita_fundicion_coladas where libro_id=p_id) then
      raise exception 'El movimiento tiene un documento de origen. Corrígelo desde su operación de origen.';
    end if;
    insert into public.inventario_pmp_papelera(id,fila,eliminado_por,eliminado_motivo)
      values(p_id,to_jsonb(f),auth.uid(),trim(p_motivo));
    delete from public.casiterita_libro where id=p_id;
  end if;
end;
$$;

create or replace function public.inventario_pmp_papelera_listar()
returns table(id text,titulo text,eliminado_en timestamptz,eliminado_motivo text)
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.puede_modulo('inventario','lectura') then
    raise exception 'Se requiere lectura en Inventario' using errcode='42501';
  end if;
  return query select p.id::text,concat_ws(' · ',p.fila->>'descripcion',p.fila->>'fecha'),p.eliminado_en,p.eliminado_motivo
    from public.inventario_pmp_papelera p order by p.eliminado_en desc,p.id;
end;
$$;

create or replace function public.inventario_pmp_papelera_vaciar(p_ids uuid[])
returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  if not public.puede_vaciar_papelera('inventario') or not public.casiterita_puede_escribir() then
    raise exception 'Falta el permiso Vaciar papelera en Inventario' using errcode='42501';
  end if;
  delete from public.inventario_pmp_papelera where id=any(p_ids);
  get diagnostics n=row_count;
  return n;
end;
$$;
revoke execute on function public.inventario_pmp_papelera_listar(),public.inventario_pmp_papelera_cambiar(uuid,text),
  public.inventario_pmp_papelera_vaciar(uuid[]) from public,anon;
grant execute on function public.inventario_pmp_papelera_listar(),public.inventario_pmp_papelera_cambiar(uuid,text),
  public.inventario_pmp_papelera_vaciar(uuid[]) to authenticated;
update public.roles_permisos set permisos=jsonb_set(permisos,'{inventario}',
  coalesce(permisos->'inventario','{}'::jsonb)||'{"vaciar_papelera":true}'::jsonb,true) where role='admin';
commit;
