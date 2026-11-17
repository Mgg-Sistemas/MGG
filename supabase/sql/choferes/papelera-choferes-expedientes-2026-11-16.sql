-- ============================================================
-- Módulo: choferes
-- Archivo: papelera-choferes-expedientes-2026-11-16.sql
-- Estado: APLICADO EN PRODUCCIÓN
-- ============================================================

begin;

do $$
declare t text;
begin
  foreach t in array array['choferes_conductores','choferes_documentos','choferes_viaticos','choferes_viajes','choferes_pagos'] loop
    execute format('alter table public.%I add column if not exists eliminado_en timestamptz,
      add column if not exists eliminado_por uuid, add column if not exists eliminado_motivo text', t);
    execute format('revoke delete on public.%I from authenticated, anon', t);
    execute format('drop policy if exists papelera_choferes_select on public.%I', t);
    execute format('create policy papelera_choferes_select on public.%I as restrictive for select to authenticated using (eliminado_en is null%s)', t,
      case when t = 'choferes_documentos' then ' and exists (select 1 from public.choferes_conductores c where c.id = chofer_id and c.eliminado_en is null)' else '' end);
    execute format('drop policy if exists papelera_choferes_insert on public.%I', t);
    execute format('create policy papelera_choferes_insert on public.%I as restrictive for insert to authenticated
      with check (eliminado_en is null and eliminado_por is null and eliminado_motivo is null)', t);
    execute format('drop policy if exists papelera_choferes_update on public.%I', t);
    execute format('create policy papelera_choferes_update on public.%I as restrictive for update to authenticated
      using (eliminado_en is null) with check (eliminado_en is null and eliminado_por is null and eliminado_motivo is null)', t);
    execute format('drop policy if exists papelera_choferes_delete on public.%I', t);
    execute format('create policy papelera_choferes_delete on public.%I as restrictive for delete to authenticated using (false)', t);
  end loop;
end;
$$;

alter table public.choferes_pagos add column if not exists papelera_viajes uuid[] not null default '{}';

drop index if exists public.choferes_viajes_chofer_en_ruta;
create unique index choferes_viajes_chofer_en_ruta on public.choferes_viajes(chofer_id)
  where estado = 'en_ruta' and eliminado_en is null;
drop index if exists public.choferes_viajes_vehiculo_en_ruta;
create unique index choferes_viajes_vehiculo_en_ruta on public.choferes_viajes(vehiculo_id)
  where estado = 'en_ruta' and vehiculo_id is not null and eliminado_en is null;

create or replace function public.choferes_papelera_referencias()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  nueva jsonb := to_jsonb(new);
  anterior jsonb;
begin
  if tg_op = 'UPDATE' then
    anterior := to_jsonb(old);
    -- Los RPC operativos existentes tampoco pueden editar filas archivadas.
    if old.eliminado_en is not null and new.eliminado_en is not null then
      if tg_table_name = 'choferes_viajes' and nueva->>'pago_id' is null and anterior->>'pago_id' is not null
        and (nueva - 'pago_id' - 'updated_at') = (anterior - 'pago_id' - 'updated_at')
        and exists (select 1 from public.choferes_pagos where id=(anterior->>'pago_id')::uuid and estado='anulado') then
        return new;
      end if;
      -- Las FK SET NULL dejan el historial existente en un estado válido.
      if pg_trigger_depth() > 1
        and (nueva - 'pago_id' - 'viaje_id' - 'vehiculo_id' - 'updated_at') =
            (anterior - 'pago_id' - 'viaje_id' - 'vehiculo_id' - 'updated_at')
        and (nueva->>'pago_id' is null or nueva->>'pago_id' = anterior->>'pago_id')
        and (nueva->>'viaje_id' is null or nueva->>'viaje_id' = anterior->>'viaje_id')
        and (nueva->>'vehiculo_id' is null or nueva->>'vehiculo_id' = anterior->>'vehiculo_id') then
        return new;
      end if;
      raise exception 'El registro está en la papelera. Recupéralo antes de editarlo.';
    end if;
  end if;

  if nueva->>'chofer_id' is not null and (anterior is null or nueva->>'chofer_id' is distinct from anterior->>'chofer_id'
      or (old.eliminado_en is not null and new.eliminado_en is null)) then
    perform 1 from public.choferes_conductores where id = (nueva->>'chofer_id')::uuid and eliminado_en is null for key share;
    if not found then raise exception 'El conductor está en la papelera. Recupéralo primero.'; end if;
  end if;
  if nueva->>'viaje_id' is not null and (anterior is null or nueva->>'viaje_id' is distinct from anterior->>'viaje_id'
      or (old.eliminado_en is not null and new.eliminado_en is null)) then
    perform 1 from public.choferes_viajes where id = (nueva->>'viaje_id')::uuid and eliminado_en is null for key share;
    if not found then raise exception 'El viaje está en la papelera. Recupéralo primero.'; end if;
  end if;
  if nueva->>'pago_id' is not null and (anterior is null or nueva->>'pago_id' is distinct from anterior->>'pago_id'
      or (old.eliminado_en is not null and new.eliminado_en is null)) then
    perform 1 from public.choferes_pagos where id = (nueva->>'pago_id')::uuid and eliminado_en is null for key share;
    if not found then raise exception 'El recibo está en la papelera. Recupéralo primero.'; end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.choferes_papelera_referencias() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['choferes_conductores','choferes_documentos','choferes_viaticos','choferes_viajes','choferes_pagos'] loop
    execute format('drop trigger if exists choferes_papelera_referencias on public.%I', t);
    execute format('create trigger choferes_papelera_referencias before insert or update on public.%I
      for each row execute function public.choferes_papelera_referencias()', t);
  end loop;
end;
$$;

create or replace function public.choferes_papelera_guardar_expediente()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if pg_trigger_depth() > 1 and (old.eliminado_en is not null or exists (
    select 1 from public.choferes_documentos where chofer_id=old.id and eliminado_en is not null
  )) then
    raise exception 'Este expediente o uno de sus documentos está en la papelera de Choferes.';
  end if;
  return old;
end;
$$;
revoke execute on function public.choferes_papelera_guardar_expediente() from public, anon, authenticated;
drop trigger if exists choferes_papelera_guardar_expediente on public.choferes_conductores;
create trigger choferes_papelera_guardar_expediente before delete on public.choferes_conductores
  for each row execute function public.choferes_papelera_guardar_expediente();

create or replace function public.choferes_papelera_documento_vigente(p_chofer uuid, p_tipo text, p_etiqueta text)
returns void language sql security definer set search_path = '' as $$
  update public.choferes_documentos d
     set vigente = (d.id = (
       select a.id from public.choferes_documentos a
        where a.chofer_id = p_chofer and a.tipo = p_tipo and a.eliminado_en is null
          and (p_tipo <> 'otro' or a.etiqueta is not distinct from p_etiqueta)
        order by a.created_at desc, a.id desc limit 1
     ))
   where d.chofer_id = p_chofer and d.tipo = p_tipo and d.eliminado_en is null
     and (p_tipo <> 'otro' or d.etiqueta is not distinct from p_etiqueta);
$$;
revoke execute on function public.choferes_papelera_documento_vigente(uuid,text,text) from public, anon, authenticated;

create or replace function public.choferes_papelera_cambiar(p_tabla text, p_id uuid, p_motivo text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  fila jsonb;
  relacionados uuid[];
  cantidad integer;
  archivar boolean := p_motivo is not null;
begin
  if not public.puede_modulo('choferes', 'escritura') then
    raise exception 'Se requiere escritura en Choferes' using errcode = '42501';
  end if;
  if p_tabla is null or p_tabla not in ('choferes_conductores','choferes_documentos','choferes_viaticos','choferes_viajes','choferes_pagos') then
    raise exception 'Tipo de registro inválido' using errcode = '22023';
  end if;
  if archivar and char_length(trim(p_motivo)) not between 5 and 500 then
    raise exception 'Indica un motivo de 5 a 500 caracteres' using errcode = '22023';
  end if;

  if p_tabla = 'choferes_documentos' then
    perform 1 from public.choferes_conductores c join public.choferes_documentos d on d.chofer_id = c.id
      where d.id = p_id and c.eliminado_en is null for update of c;
    if not found then raise exception 'Recupera el expediente del conductor primero.'; end if;
  end if;
  execute format('select to_jsonb(t) from public.%I t where id=$1 for update', p_tabla) into fila using p_id;
  if fila is null or archivar <> (fila->>'eliminado_en' is null) then
    raise exception 'El estado del registro cambió. Actualiza la lista.';
  end if;

  if archivar then
    if p_tabla = 'choferes_conductores' and (
      exists(select 1 from public.choferes_viajes where chofer_id=p_id) or
      exists(select 1 from public.choferes_viaticos where chofer_id=p_id) or
      exists(select 1 from public.choferes_pagos where chofer_id=p_id)
    ) then
      raise exception 'Este conductor tiene viajes, viáticos o recibos registrados. Puedes desactivarlo.';
    end if;
    if p_tabla = 'choferes_viaticos' and fila->>'movimiento_caja_id' is not null then
      raise exception 'Este viático movió una caja de Tesorería. Corrígelo desde el libro de la caja.';
    end if;
    if p_tabla = 'choferes_pagos' then
      if fila->>'estado' = 'pagado' then
        raise exception 'El recibo está pagado. Anúlalo antes de enviarlo a la papelera.';
      end if;
      if fila->>'estado' = 'pendiente' then
        -- Retiene la relación original y libera los viajes para la siguiente liquidación.
        with libres as (
          update public.choferes_viajes set pago_id=null where pago_id=p_id and eliminado_en is null returning id
        )
        update public.choferes_pagos set papelera_viajes=coalesce((select array_agg(id order by id) from libres),'{}') where id=p_id;
      end if;
    end if;
    execute format('update public.%I set eliminado_en=now(), eliminado_por=auth.uid(), eliminado_motivo=trim($2) where id=$1', p_tabla)
      using p_id, p_motivo;
  else
    execute format('update public.%I set eliminado_en=null, eliminado_por=null, eliminado_motivo=null where id=$1', p_tabla) using p_id;
    if p_tabla = 'choferes_pagos' and fila->>'estado' = 'pendiente' then
      select papelera_viajes into relacionados from public.choferes_pagos where id=p_id;
      update public.choferes_viajes set pago_id=p_id
       where id=any(relacionados) and eliminado_en is null and pago_id is null and pagado_at is null
         and estado='finalizado' and chofer_id=(fila->>'chofer_id')::uuid;
      get diagnostics cantidad = row_count;
      if cantidad <> cardinality(relacionados) then
        raise exception 'Uno o más viajes ya no están disponibles. Revisa sus recibos antes de recuperar este pago.';
      end if;
      update public.choferes_pagos set papelera_viajes='{}' where id=p_id;
    end if;
  end if;

  if p_tabla = 'choferes_documentos' then
    perform public.choferes_papelera_documento_vigente(
      (fila->>'chofer_id')::uuid, fila->>'tipo', fila->>'etiqueta');
  end if;
end;
$$;

create or replace function public.choferes_papelera_listar()
returns table (id text, titulo text, eliminado_en timestamptz, eliminado_motivo text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.puede_modulo('choferes', 'lectura') then
    raise exception 'Se requiere lectura en Choferes' using errcode = '42501';
  end if;
  return query select * from (
    select 'choferes_conductores:'||c.id, 'Expediente · '||coalesce(p.nombre||' '||p.apellido,
      nullif(concat_ws(' ',c.nombre,c.apellido),''),c.id::text), c.eliminado_en, c.eliminado_motivo
    from public.choferes_conductores c left join public.personal p on p.id=c.personal_id
    union all
    select 'choferes_documentos:'||d.id, 'Documento · '||d.nombre, d.eliminado_en, d.eliminado_motivo from public.choferes_documentos d
    union all
    select 'choferes_viaticos:'||v.id, 'Viático · '||v.concepto, v.eliminado_en, v.eliminado_motivo from public.choferes_viaticos v
    union all
    select 'choferes_viajes:'||v.id, 'Viaje · '||v.numero, v.eliminado_en, v.eliminado_motivo from public.choferes_viajes v
    union all
    select 'choferes_pagos:'||p.id, 'Recibo · '||p.numero, p.eliminado_en, p.eliminado_motivo from public.choferes_pagos p
  ) as r(i,t,e,m) where r.e is not null order by r.e desc,r.i;
end;
$$;

create table if not exists public.choferes_documentos_por_vaciar (ruta text primary key);
alter table public.choferes_documentos_por_vaciar enable row level security;
revoke all on public.choferes_documentos_por_vaciar from public, anon, authenticated;
grant select on public.choferes_documentos_por_vaciar to authenticated;
drop policy if exists choferes_documentos_por_vaciar_read on public.choferes_documentos_por_vaciar;
create policy choferes_documentos_por_vaciar_read on public.choferes_documentos_por_vaciar
  for select to authenticated using ((select public.puede_vaciar_papelera('choferes')));

create index if not exists choferes_documentos_path_idx on public.choferes_documentos(path);
create or replace function public.choferes_papelera_soporte_libre(p_ruta text)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.choferes_documentos where path=p_ruta)
    and (public.puede_vaciar_papelera('choferes') or (
      public.puede_modulo('choferes','escritura')
      and not exists (select 1 from public.choferes_documentos_por_vaciar where ruta=p_ruta)
    ));
$$;

drop policy if exists choferes_papelera_soporte_delete on storage.objects;
create policy choferes_papelera_soporte_delete on storage.objects as restrictive for delete to authenticated
  using (bucket_id <> 'personal-docs' or name not like 'choferes/%' or public.choferes_papelera_soporte_libre(name));
drop policy if exists choferes_papelera_soporte_update on storage.objects;
create policy choferes_papelera_soporte_update on storage.objects as restrictive for update to authenticated
  using (bucket_id <> 'personal-docs' or name not like 'choferes/%' or public.choferes_papelera_soporte_libre(name))
  with check (bucket_id <> 'personal-docs' or name not like 'choferes/%' or public.choferes_papelera_soporte_libre(name));

create or replace function public.choferes_papelera_vaciar(p_ids text[])
returns integer language plpgsql security definer set search_path = '' as $$
declare
  t text;
  ids uuid[];
  cantidad integer;
  total integer := 0;
begin
  if not public.puede_vaciar_papelera('choferes') then
    raise exception 'Falta el permiso Vaciar papelera en Choferes' using errcode = '42501';
  end if;
  foreach t in array array['choferes_viaticos','choferes_viajes','choferes_pagos','choferes_documentos','choferes_conductores'] loop
    select array_agg(split_part(i,':',2)::uuid) into ids from unnest(p_ids) i where split_part(i,':',1)=t;
    if ids is null then continue; end if;
    if t='choferes_conductores' then
      perform 1 from public.choferes_conductores where id=any(ids) and eliminado_en is not null for update;
      insert into public.choferes_documentos_por_vaciar (ruta)
      select d.path from public.choferes_documentos d join public.choferes_conductores c on c.id=d.chofer_id
       where c.id=any(ids) and c.eliminado_en is not null and d.path like 'choferes/%'
      on conflict do nothing;
    elsif t='choferes_documentos' then
      perform 1 from public.choferes_documentos where id=any(ids) and eliminado_en is not null for update;
      insert into public.choferes_documentos_por_vaciar (ruta)
      select path from public.choferes_documentos where id=any(ids) and eliminado_en is not null and path like 'choferes/%'
      on conflict do nothing;
    end if;
    execute format('delete from public.%I where id=any($1) and eliminado_en is not null', t) using ids;
    get diagnostics cantidad=row_count;
    total := total+cantidad;
  end loop;
  return total;
end;
$$;

create or replace function public.choferes_papelera_cerrar_limpieza(p_rutas text[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.puede_vaciar_papelera('choferes') then
    raise exception 'Falta el permiso Vaciar papelera en Choferes' using errcode = '42501';
  end if;
  delete from public.choferes_documentos_por_vaciar q where q.ruta=any(p_rutas) and (
    not exists (select 1 from storage.objects where bucket_id='personal-docs' and name=q.ruta)
    or exists (select 1 from public.choferes_documentos where path=q.ruta)
  );
end;
$$;

revoke execute on function public.choferes_papelera_listar(), public.choferes_papelera_cambiar(text,uuid,text),
  public.choferes_papelera_vaciar(text[]), public.choferes_papelera_cerrar_limpieza(text[]),
  public.choferes_papelera_soporte_libre(text) from public, anon;
grant execute on function public.choferes_papelera_listar(), public.choferes_papelera_cambiar(text,uuid,text),
  public.choferes_papelera_vaciar(text[]), public.choferes_papelera_cerrar_limpieza(text[]),
  public.choferes_papelera_soporte_libre(text) to authenticated;

commit;
