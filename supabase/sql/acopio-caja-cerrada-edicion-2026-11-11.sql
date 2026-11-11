-- ============================================================
-- MGG · Editar una caja CERRADA de los centros de costo, con motivo (11-11-2026)
--
-- Pedido de la administradora: una caja cerrada se puede corregir, pero
-- indicando POR QUÉ. Cada cambio queda en `acopio_cajas.ediciones` (quién,
-- cuándo, motivo, el movimiento antes y después, y el saldo antes/después).
--
--  · RPC `acopio_caja_cerrada_editar(p_mov_id, p_accion, p_cambios, p_motivo)`:
--    'editar' o 'borrar' un movimiento de una caja cerrada. Exige permiso de
--    escritura en Acopio (matriz) y un motivo de al menos 5 letras.
--    Recalcula el saldo final ($) de la caja y, si ese saldo se arrastró a la
--    caja siguiente («SALDO INICIAL · viene del cierre …»), corrige ese
--    arrastre por la diferencia (y sigue la cadena si la siguiente también
--    está cerrada). Los Kg que ya pasaron a Recepciones NO se tocan.
--  · Trigger `trg_acopio_mov_caja_cerrada`: fuera de esa RPC, nadie agrega,
--    cambia ni borra movimientos de una caja cerrada.
-- ============================================================

alter table public.acopio_cajas add column if not exists ediciones jsonb not null default '[]'::jsonb;

create or replace function public.guard_acopio_mov_caja_cerrada()
returns trigger language plpgsql set search_path = public as $$
declare v_caja uuid; v_estado text; v_num text;
begin
  v_caja := case when tg_op = 'DELETE' then old.caja_id else new.caja_id end;
  if v_caja is null then return case when tg_op = 'DELETE' then old else new end; end if;
  select estado, numero into v_estado, v_num from public.acopio_cajas where id = v_caja;
  -- Caja inexistente (borrado en cascada) o abierta: sin restricción.
  if v_estado is distinct from 'cerrada' then return case when tg_op = 'DELETE' then old else new end; end if;
  if coalesce(current_setting('mgg.caja_cerrada_ok', true), '') = '1' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'La caja % está cerrada: para corregirla usa «✎ Editar caja cerrada» en Cierres de caja e indica el motivo.', coalesce(v_num, '');
end $$;

drop trigger if exists trg_acopio_mov_caja_cerrada on public.acopio_caja_movimientos;
create trigger trg_acopio_mov_caja_cerrada
  before insert or update or delete on public.acopio_caja_movimientos
  for each row execute function public.guard_acopio_mov_caja_cerrada();

create or replace function public.acopio_caja_saldo_usd(p_caja uuid)
returns numeric language sql stable set search_path = public as $$
  select round(coalesce(sum(coalesce(usd_entregado,0) - coalesce(facturados,0) - coalesce(gastos,0)
    - coalesce(nominas,0) - coalesce(traslado,0) - coalesce(compra_material,0)), 0), 2)
  from public.acopio_caja_movimientos where caja_id = p_caja;
$$;

create or replace function public.acopio_caja_cerrada_editar(
  p_mov_id uuid, p_accion text, p_cambios jsonb, p_motivo text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_mov public.acopio_caja_movimientos;
  v_despues public.acopio_caja_movimientos;
  v_caja public.acopio_cajas;
  v_sig public.acopio_cajas;
  v_actor text; v_actor_name text;
  v_saldo_antes numeric; v_saldo_desp numeric; v_delta numeric;
  v_cambios jsonb;
  v_arrastres jsonb := '[]'::jsonb;
  v_guard int := 0;
begin
  if not public.puede_modulo('acopio', 'escritura') then
    raise exception 'No tienes permiso de escritura en Acopio / Centros de costo.';
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then
    raise exception 'Indica el motivo por el que se edita la caja cerrada (mínimo 5 letras).';
  end if;
  if p_accion not in ('editar', 'borrar') then raise exception 'Acción no válida: %', p_accion; end if;

  select * into v_mov from public.acopio_caja_movimientos where id = p_mov_id for update;
  if not found then raise exception 'El movimiento ya no existe.'; end if;
  select * into v_caja from public.acopio_cajas where id = v_mov.caja_id for update;
  if v_caja.estado is distinct from 'cerrada' then
    raise exception 'La caja no está cerrada: edítala desde la lista de movimientos.';
  end if;

  select u.email, coalesce(nullif(trim(u.nombre), ''), u.email) into v_actor, v_actor_name
    from public.usuarios u where u.id = auth.uid();
  v_saldo_antes := public.acopio_caja_saldo_usd(v_caja.id);

  perform set_config('mgg.caja_cerrada_ok', '1', true);

  if p_accion = 'borrar' then
    delete from public.acopio_caja_movimientos where id = p_mov_id;
  else
    -- Solo los campos que el formulario de edición maneja.
    select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into v_cambios
      from jsonb_each(coalesce(p_cambios, '{}'::jsonb)) as e(k, v)
     where k in ('fecha','descripcion','usd_entregado','kg_cerrados','facturados','gastos','nominas','traslado',
                 'compra_material','compra_material_kg','compra_material_tasa','kg_recibidos',
                 'clasif_grupo','clasif_valor','costo_clasificacion','costo_subclasificacion','vehiculo');
    update public.acopio_caja_movimientos m set
      (fecha, descripcion, usd_entregado, kg_cerrados, facturados, gastos, nominas, traslado,
       compra_material, compra_material_kg, compra_material_tasa, kg_recibidos,
       clasif_grupo, clasif_valor, costo_clasificacion, costo_subclasificacion, vehiculo, updated_at)
      = (select r.fecha, r.descripcion, r.usd_entregado, r.kg_cerrados, r.facturados, r.gastos, r.nominas, r.traslado,
                r.compra_material, r.compra_material_kg, r.compra_material_tasa, r.kg_recibidos,
                r.clasif_grupo, r.clasif_valor, r.costo_clasificacion, r.costo_subclasificacion, r.vehiculo, now()
           from jsonb_populate_record(v_mov, v_cambios) r)
     where m.id = p_mov_id
     returning * into v_despues;
  end if;

  v_saldo_desp := public.acopio_caja_saldo_usd(v_caja.id);
  v_delta := round(v_saldo_desp - v_saldo_antes, 2);

  update public.acopio_cajas set
    saldo_final = case when v_delta <> 0 then round(coalesce(saldo_final, v_saldo_antes) + v_delta, 2) else saldo_final end,
    ediciones = coalesce(ediciones, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'at', now(), 'actor', v_actor, 'actor_name', v_actor_name, 'motivo', trim(p_motivo),
      'accion', p_accion, 'mov_id', p_mov_id, 'descripcion', v_mov.descripcion,
      'antes', to_jsonb(v_mov), 'despues', case when v_despues.id is null then null else to_jsonb(v_despues) end,
      'saldo_antes', v_saldo_antes, 'saldo_despues', v_saldo_desp)),
    updated_at = now()
  where id = v_caja.id;

  -- El saldo en $ arrastrado a la caja siguiente se corrige por la diferencia.
  while v_delta <> 0 and v_guard < 50 loop
    v_guard := v_guard + 1;
    select * into v_sig from public.acopio_cajas c
     where c.centro_nombre is not distinct from v_caja.centro_nombre and c.id <> v_caja.id
       and exists (select 1 from public.acopio_caja_movimientos m
                    where m.caja_id = c.id and m.descripcion = 'SALDO INICIAL · viene del cierre ' || v_caja.numero)
     limit 1;
    exit when not found;
    update public.acopio_caja_movimientos
       set usd_entregado = round(coalesce(usd_entregado, 0) + v_delta, 2), updated_at = now()
     where caja_id = v_sig.id and descripcion = 'SALDO INICIAL · viene del cierre ' || v_caja.numero;
    v_arrastres := v_arrastres || jsonb_build_array(jsonb_build_object('caja', v_sig.numero, 'delta', v_delta));
    if v_sig.estado = 'cerrada' then
      update public.acopio_cajas set saldo_final = round(coalesce(saldo_final, 0) + v_delta, 2),
        ediciones = coalesce(ediciones, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'at', now(), 'actor', v_actor, 'actor_name', v_actor_name,
          'motivo', 'Arrastre por edición de la caja ' || v_caja.numero || ': ' || trim(p_motivo),
          'accion', 'arrastre', 'delta', v_delta)),
        updated_at = now()
      where id = v_sig.id;
      v_caja := v_sig;   -- sigue la cadena
    else
      exit;
    end if;
  end loop;

  return jsonb_build_object('saldo_antes', v_saldo_antes, 'saldo_despues', v_saldo_desp, 'delta', v_delta, 'arrastres', v_arrastres);
end $$;

revoke all on function public.acopio_caja_cerrada_editar(uuid, text, jsonb, text) from public, anon;
grant execute on function public.acopio_caja_cerrada_editar(uuid, text, jsonb, text) to authenticated;
revoke all on function public.acopio_caja_saldo_usd(uuid) from public, anon;
grant execute on function public.acopio_caja_saldo_usd(uuid) to authenticated;

select 'ok' as listo;
