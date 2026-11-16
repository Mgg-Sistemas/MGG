begin;

do $$
declare t text;
begin
  foreach t in array array['categorias_documentacion','destinatarios_documentacion','catalogo_documentacion'] loop
    execute format('alter table public.%I add column if not exists eliminado_en timestamptz,
      add column if not exists eliminado_por uuid, add column if not exists eliminado_motivo text',t);
    execute format('revoke delete on public.%I from authenticated, anon',t);
    execute format('drop policy if exists doc_catalogo_delete on public.%I',t);
    execute format('create policy doc_catalogo_delete on public.%I as restrictive for delete to authenticated using(false)',t);
    execute format('drop policy if exists doc_catalogo_select on public.%I',t);
    execute format('create policy doc_catalogo_select on public.%I as restrictive for select to authenticated using(eliminado_en is null)',t);
    execute format('drop policy if exists doc_catalogo_insert on public.%I',t);
    execute format('create policy doc_catalogo_insert on public.%I as restrictive for insert to authenticated
      with check(eliminado_en is null and eliminado_por is null and eliminado_motivo is null)',t);
    execute format('drop policy if exists doc_catalogo_update on public.%I',t);
    execute format('create policy doc_catalogo_update on public.%I as restrictive for update to authenticated
      using(eliminado_en is null) with check(eliminado_en is null and eliminado_por is null and eliminado_motivo is null)',t);
  end loop;
end;
$$;

create or replace function public.doc_catalogo_papelera_cambiar(p_tabla text,p_id uuid,p_motivo text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare cantidad integer;
begin
  if not public.puede_modulo('documentacion','escritura') then
    raise exception 'Se requiere escritura en Documentación' using errcode='42501';
  end if;
  if p_tabla is null or p_tabla not in ('categorias_documentacion','destinatarios_documentacion','catalogo_documentacion') then
    raise exception 'Tipo de registro inválido' using errcode='22023';
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
  get diagnostics cantidad=row_count;
  if cantidad=0 then raise exception 'El estado del registro cambió. Actualiza la lista.'; end if;
end;
$$;

create or replace function public.doc_catalogo_papelera_listar()
returns table (id text,titulo text,eliminado_en timestamptz,eliminado_motivo text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.puede_modulo('documentacion','lectura') then
    raise exception 'Se requiere lectura en Documentación' using errcode='42501';
  end if;
  return query select * from (
    select 'categorias_documentacion:'||c.id,'Categoría · '||c.nombre,c.eliminado_en,c.eliminado_motivo
    from public.categorias_documentacion c
    union all
    select 'destinatarios_documentacion:'||d.id,'Destinatario · '||d.razon_social,d.eliminado_en,d.eliminado_motivo
    from public.destinatarios_documentacion d
    union all
    select 'catalogo_documentacion:'||c.id,'Texto de catálogo · '||c.nombre,c.eliminado_en,c.eliminado_motivo
    from public.catalogo_documentacion c
  ) r(i,t,e,m) where r.e is not null order by r.e desc,r.i;
end;
$$;

create or replace function public.doc_catalogo_vaciar_papelera(p_ids text[])
returns integer language plpgsql security definer set search_path = '' as $$
declare
  t text;
  ids uuid[];
  cantidad integer;
  total integer := 0;
begin
  if not public.puede_vaciar_papelera('documentacion') then
    raise exception 'Falta el permiso Vaciar papelera en Documentación' using errcode='42501';
  end if;
  foreach t in array array['categorias_documentacion','destinatarios_documentacion','catalogo_documentacion'] loop
    select array_agg(split_part(i,':',2)::uuid) into ids from unnest(p_ids) i where split_part(i,':',1)=t;
    if ids is null then continue; end if;
    if t='categorias_documentacion' then
      perform 1 from public.categorias_documentacion where id=any(ids) and eliminado_en is not null for update;
      update public.documentos_empresa d set categoria='General',updated_at=now()
      from public.categorias_documentacion c where c.id=any(ids) and c.eliminado_en is not null and d.categoria=c.nombre;
    end if;
    execute format('delete from public.%I where id=any($1) and eliminado_en is not null',t) using ids;
    get diagnostics cantidad=row_count;
    total := total+cantidad;
  end loop;
  return total;
end;
$$;

revoke execute on function public.doc_catalogo_papelera_cambiar(text,uuid,text),
  public.doc_catalogo_papelera_listar(), public.doc_catalogo_vaciar_papelera(text[]) from public, anon;
grant execute on function public.doc_catalogo_papelera_cambiar(text,uuid,text),
  public.doc_catalogo_papelera_listar(), public.doc_catalogo_vaciar_papelera(text[]) to authenticated;

commit;
