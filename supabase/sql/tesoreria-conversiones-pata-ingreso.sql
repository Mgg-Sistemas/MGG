-- ============================================================
-- MGG · Tesorería · Conversiones: la pata de ingreso quedaba suelta (14-10-2026)
-- caja_convertir_divisa buscaba el ingreso recién creado con `at >= clock_timestamp()`,
-- pero `at` se sella con now() (inicio de la transacción), que SIEMPRE es menor:
-- la pata de ingreso nunca recibía conversion_id ni la fecha elegida, y el historial
-- (que exige las dos patas) no mostraba ninguna conversión hecha desde el 11-09.
-- Arreglo: caja_ingresar_divisa devuelve el id del movimiento y el RPC lo usa directo.
-- Idempotente. No borra nada: solo ata las patas sueltas y les pone fecha y categoría.
-- ============================================================

create or replace function public.caja_ingresar_divisa(p_caja uuid, p_cuenta text, p_moneda text, p_monto numeric, p_tasa_bs numeric, p_origen text, p_motivo text, p_actor text, p_actor_name text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_monto numeric; v_es_bs boolean; v_tasa_bs numeric; v_saldo numeric; v_tasa_ant numeric; v_desp numeric; v_prom numeric; v_mov uuid;
begin
  if not public.is_operativo() then raise exception 'No autorizado.'; end if;
  v_monto := round(coalesce(p_monto,0),2);
  if v_monto <= 0 then raise exception 'El monto debe ser mayor que 0.'; end if;
  v_es_bs := (p_moneda='Bs');
  v_tasa_bs := case when v_es_bs then 1 else round(coalesce(p_tasa_bs,0),4) end;
  if (not v_es_bs) and v_tasa_bs <= 0 then raise exception 'Indica la tasa de compra (Bs por unidad).'; end if;
  select saldo, coalesce(tasa_prom,0) into v_saldo, v_tasa_ant from caja_saldos
    where caja_id=p_caja and cuenta=p_cuenta and moneda=p_moneda for update;
  if not found then
    insert into caja_saldos (caja_id,cuenta,moneda,saldo,tasa_prom,updated_at)
      values (p_caja,p_cuenta,p_moneda,0, case when v_es_bs then 1 else 0 end, now()) on conflict (caja_id,cuenta,moneda) do nothing;
    select saldo, coalesce(tasa_prom,0) into v_saldo, v_tasa_ant from caja_saldos
      where caja_id=p_caja and cuenta=p_cuenta and moneda=p_moneda for update;
  end if;
  v_saldo := coalesce(v_saldo,0);
  v_desp := round(v_saldo + v_monto, 2);
  if v_es_bs then v_prom := 1;
  elsif v_saldo > 0 and v_tasa_ant > 0 then v_prom := round((v_saldo*v_tasa_ant + v_monto*v_tasa_bs)/v_desp, 4);
  else v_prom := round(v_tasa_bs,4); end if;
  update caja_saldos set saldo=v_desp, tasa_prom=v_prom, updated_at=now() where caja_id=p_caja and cuenta=p_cuenta and moneda=p_moneda;
  insert into caja_lotes (caja_id,cuenta,moneda,monto,tasa_bs,origen,motivo,actor,actor_name)
    values (p_caja,p_cuenta,p_moneda,v_monto, case when v_es_bs then null else v_tasa_bs end, p_origen, p_motivo, p_actor, p_actor_name);
  insert into movimientos_caja (caja_id,tipo,monto,moneda,cuenta,tasa_bs,saldo_antes,saldo_despues,motivo,categoria,actor,actor_name)
    values (p_caja,'ingreso',v_monto,p_moneda,p_cuenta, case when v_es_bs then null else v_tasa_bs end, v_saldo, v_desp,
            coalesce(p_motivo, p_origen, 'Ingreso de divisa'), case when p_origen = 'conversion' then 'conversion' else null end, p_actor, p_actor_name)
    returning id into v_mov;
  return jsonb_build_object('saldo', v_desp, 'tasa_prom', v_prom, 'mov_id', v_mov);
end;
$$;

create or replace function public.caja_convertir_divisa(p_o_caja uuid, p_o_cuenta text, p_moneda_de text, p_d_caja uuid, p_d_cuenta text, p_moneda_a text, p_monto_de numeric, p_monto_a numeric, p_tasa_bs_dest numeric, p_motivo text, p_actor text, p_actor_name text, p_fecha timestamptz default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_eg uuid; v_in uuid; v_conv uuid := gen_random_uuid();
begin
  if not public.is_operativo() then raise exception 'No autorizado.'; end if;
  v_eg := public.caja_egresar_divisa(p_o_caja, p_o_cuenta, p_moneda_de, p_monto_de, p_motivo, 'conversion', null, null, null, p_actor, p_actor_name);
  v_in := (public.caja_ingresar_divisa(p_d_caja, p_d_cuenta, p_moneda_a, p_monto_a, p_tasa_bs_dest, 'conversion', p_motivo, p_actor, p_actor_name) ->> 'mov_id')::uuid;
  if v_in is null then raise exception 'No se pudo ubicar la pata de ingreso de la conversión.'; end if;
  update movimientos_caja
     set conversion_id = v_conv, categoria = 'conversion', at = coalesce(p_fecha, at)
   where id in (v_eg, v_in);
  return v_conv;
end;
$$;

-- ───────── Datos: atar las patas de ingreso que quedaron sueltas ─────────
-- Pareja = misma leyenda «Conversión …», mismo actor, ingreso sin conversion_id y
-- salida con conversion_id que todavía no tiene ingreso. Toma la fecha de la salida
-- (la que eligió la usuaria) y la categoría conversion.
with salidas as (
  select s.id, s.conversion_id, s.motivo, s.actor, s.at
  from movimientos_caja s
  where s.tipo = 'salida' and s.conversion_id is not null
    and not exists (select 1 from movimientos_caja i where i.conversion_id = s.conversion_id and i.tipo = 'ingreso')
), parejas as (
  select distinct on (i.id) i.id as ingreso_id, s.conversion_id, s.at
  from movimientos_caja i
  join salidas s on s.motivo = i.motivo and s.actor is not distinct from i.actor
  where i.tipo = 'ingreso' and i.conversion_id is null and i.motivo like 'Conversión %'
  order by i.id, abs(extract(epoch from (i.at - s.at)))
)
update movimientos_caja m
   set conversion_id = p.conversion_id, categoria = 'conversion', at = p.at
  from parejas p
 where m.id = p.ingreso_id;

-- Cotejo: no debe quedar ninguna conversión con una sola pata.
-- select conversion_id, count(*) from movimientos_caja where conversion_id is not null group by 1 having count(*) <> 2;
