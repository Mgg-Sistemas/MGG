-- ============================================================
-- Módulo: choferes
-- Archivo: choferes-pago-confirmacion-atomica-2026-11-16.sql
-- Estado: APLICADO EN PRODUCCIÓN
-- ============================================================

begin;

-- Comparte el bloqueo de fila con la papelera. El egreso y el recibo se
-- confirman en una transacción, incluso si alguien archiva el recibo a la vez.
create or replace function public.choferes_pago_confirmar(
  p_id uuid, p_metodo text, p_conductor text, p_actor text, p_actor_nombre text,
  p_caja uuid default null, p_cuenta text default null, p_moneda text default null, p_monto numeric default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  recibo public.choferes_pagos%rowtype;
  movimiento uuid;
  cantidad integer;
begin
  if not public.puede_modulo('choferes','escritura') then
    raise exception 'Se requiere escritura en Choferes' using errcode='42501';
  end if;
  select * into recibo from public.choferes_pagos where id=p_id for update;
  if not found or recibo.eliminado_en is not null or recibo.estado <> 'pendiente' then
    raise exception 'El recibo ya no está pendiente de pago. Actualiza la lista.';
  end if;
  if p_caja is not null then
    if coalesce(round(p_monto,2),0) <= 0 then
      raise exception 'El monto debe ser mayor que 0.' using errcode='22023';
    end if;
    cantidad := jsonb_array_length(recibo.detalle);
    movimiento := public.caja_gasto(p_caja, round(p_monto,2),
      concat('Pago de viajes ',recibo.numero,' · ',p_conductor,' (',cantidad,' viaje(s))'),
      'pago_viaje_chofer',p_cuenta,p_moneda,null,null,null,p_actor,p_actor_nombre);
  end if;

  update public.choferes_pagos set estado='pagado', pagado_at=now(),
    pagado_por=coalesce(nullif(btrim(p_actor_nombre),''),p_actor),
    metodo=nullif(btrim(p_metodo),''), movimiento_caja_id=movimiento
  where id=p_id;
end;
$$;

revoke execute on function public.choferes_pago_confirmar(uuid,text,text,text,text,uuid,text,text,numeric) from public, anon;
grant execute on function public.choferes_pago_confirmar(uuid,text,text,text,text,uuid,text,text,numeric) to authenticated;

commit;
