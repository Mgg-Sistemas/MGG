begin;

alter table public.movimientos_caja add column if not exists eliminado_en timestamptz,
  add column if not exists eliminado_por uuid, add column if not exists eliminado_motivo text;
revoke delete on public.movimientos_caja from authenticated,anon;
drop policy if exists tesoreria_papelera_select on public.movimientos_caja;
create policy tesoreria_papelera_select on public.movimientos_caja as restrictive for select to authenticated using(eliminado_en is null);
drop policy if exists tesoreria_papelera_update on public.movimientos_caja;
create policy tesoreria_papelera_update on public.movimientos_caja as restrictive for update to authenticated
  using(eliminado_en is null) with check(eliminado_en is null and eliminado_por is null and eliminado_motivo is null);
drop policy if exists tesoreria_papelera_insert on public.movimientos_caja;
create policy tesoreria_papelera_insert on public.movimientos_caja as restrictive for insert to authenticated
  with check(eliminado_en is null and eliminado_por is null and eliminado_motivo is null);
drop policy if exists tesoreria_papelera_delete on public.movimientos_caja;
create policy tesoreria_papelera_delete on public.movimientos_caja as restrictive for delete to authenticated using(eliminado_en is null);

create or replace function public.tesoreria_papelera_efecto(p_tipo text,p_monto numeric,p_antes numeric,p_despues numeric)
returns numeric language sql immutable set search_path='' as $$
  select round(case p_tipo
    when 'ajuste' then coalesce(p_despues,0)-coalesce(p_antes,0)
    when 'entrada' then coalesce(p_monto,0)
    when 'ingreso' then coalesce(p_monto,0)
    when 'traslado_entrada' then coalesce(p_monto,0)
    when 'salida' then -coalesce(p_monto,0)
    when 'traslado_salida' then -coalesce(p_monto,0)
    else 0 end,2);
$$;

create or replace function public.tesoreria_papelera_cambiar(p_id uuid,p_motivo text default null)
returns void language plpgsql security definer set search_path='' as $$
declare m public.movimientos_caja%rowtype; saldo_final numeric; delta numeric; caja uuid;
begin
  if not public.puede_modulo('tesoreria','escritura') then
    raise exception 'Se requiere escritura en Tesorería' using errcode='42501';
  end if;
  select caja_id into caja from public.movimientos_caja where id=p_id;
  perform 1 from public.cajas where id=caja for update;
  select * into m from public.movimientos_caja where id=p_id for update;
  if not found or (m.eliminado_en is null)<>(p_motivo is not null) then
    raise exception 'El movimiento cambió de estado. Actualiza la lista.';
  end if;
  if m.cierre_id is not null or exists (select 1 from public.cierres_caja c where c.estado='cerrado'
    and (m.at at time zone 'America/Caracas')::date between c.desde and c.hasta) then
    raise exception 'El movimiento pertenece a un período cerrado.';
  end if;
  if m.ref_orden_id is not null or m.ref_nomina_renglon_id is not null or m.ref_venta_id is not null
    or m.ref_caja_id is not null or m.conversion_id is not null or m.mineral_producto_id is not null
    or m.mineral_mov_id is not null or m.conciliada_at is not null
    or m.tipo in ('traslado_entrada','traslado_salida')
    or m.categoria in ('pago_oc','reembolso_oc','abono_cxp','pago_nomina','pago_chofer','pago_choferes')
    or exists(select 1 from public.ordenes where caja_mov_id=m.id)
    or exists(select 1 from public.nomina_renglones where caja_mov_id=m.id)
    or exists(select 1 from public.choferes_pagos where movimiento_caja_id=m.id)
    or exists(select 1 from public.choferes_viaticos where movimiento_caja_id=m.id)
    or exists(select 1 from public.abonos_credito where caja_mov_id=m.id) then
    raise exception 'El movimiento está vinculado a otro registro. Corrígelo desde su operación de origen.';
  end if;
  if p_motivo is not null and char_length(trim(p_motivo)) not between 5 and 500 then
    raise exception 'Indica un motivo de 5 a 500 caracteres' using errcode='22023';
  end if;
  delta:=public.tesoreria_papelera_efecto(m.tipo,m.monto,m.saldo_antes,m.saldo_despues);
  if p_motivo is not null then delta:=-delta; end if;
  if m.cuenta is null then
    update public.cajas set saldo=round(saldo+delta,2),updated_at=now() where id=m.caja_id returning saldo into saldo_final;
  else
    update public.caja_saldos set saldo=round(saldo+delta,2),updated_at=now()
      where caja_id=m.caja_id and cuenta=m.cuenta and moneda=m.moneda returning saldo into saldo_final;
  end if;
  if not found then raise exception 'No se encontró el saldo de la cuenta.'; end if;
  update public.movimientos_caja set
    eliminado_en=case when p_motivo is not null then now() end,
    eliminado_por=case when p_motivo is not null then auth.uid() end,
    eliminado_motivo=trim(p_motivo)
  where id=m.id;

  with efectos as (
    select id,at,public.tesoreria_papelera_efecto(tipo,monto,saldo_antes,saldo_despues) efecto
      from public.movimientos_caja
      where caja_id=m.caja_id and cuenta is not distinct from m.cuenta and moneda=m.moneda
        and eliminado_en is null and cierre_id is null
  ), cadena as (
    select id,efecto,saldo_final-coalesce(sum(efecto) over (order by at desc,id desc
      rows between unbounded preceding and 1 preceding),0) despues from efectos
  )
  update public.movimientos_caja b set saldo_antes=c.despues-c.efecto,saldo_despues=c.despues
    from cadena c where b.id=c.id and (b.saldo_antes,b.saldo_despues) is distinct from (c.despues-c.efecto,c.despues);
end;
$$;

create or replace function public.tesoreria_papelera_listar()
returns table(id text,titulo text,eliminado_en timestamptz,eliminado_motivo text)
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.puede_modulo('tesoreria','lectura') then
    raise exception 'Se requiere lectura en Tesorería' using errcode='42501';
  end if;
  return query select m.id::text,concat_ws(' · ',c.nombre,m.motivo,m.moneda||' '||m.monto),m.eliminado_en,m.eliminado_motivo
    from public.movimientos_caja m join public.cajas c on c.id=m.caja_id
    where m.eliminado_en is not null order by m.eliminado_en desc,m.id;
end;
$$;

create or replace function public.tesoreria_papelera_vaciar(p_ids uuid[])
returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  if not public.puede_vaciar_papelera('tesoreria') then
    raise exception 'Falta el permiso Vaciar papelera en Tesorería' using errcode='42501';
  end if;
  delete from public.movimientos_caja where id=any(p_ids) and eliminado_en is not null;
  get diagnostics n=row_count;
  return n;
end;
$$;

revoke execute on function public.tesoreria_papelera_listar(),public.tesoreria_papelera_cambiar(uuid,text),
  public.tesoreria_papelera_vaciar(uuid[]) from public,anon;
grant execute on function public.tesoreria_papelera_listar(),public.tesoreria_papelera_cambiar(uuid,text),
  public.tesoreria_papelera_vaciar(uuid[]) to authenticated;
update public.roles_permisos set permisos=jsonb_set(permisos,'{tesoreria}',
  coalesce(permisos->'tesoreria','{}'::jsonb)||'{"vaciar_papelera":true}'::jsonb,true) where role='admin';
commit;
