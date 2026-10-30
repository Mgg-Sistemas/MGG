-- ============================================================
-- MGG · Compras · el monto que paga Tesorería BAJA o va COMPLETO según la retención (30-10-2026)
-- Retención ANTES de pagar: Retenciones anota cuánto retuvo (Bs / $ / tasa) al marcarla
-- hecha; Tesorería paga el total MENOS eso (el monto BAJA).
-- Retención DESPUÉS de pagar: Tesorería paga el total COMPLETO y la retención se hace luego.
-- Solo aplica con el flujo nuevo (ordenes.retencion_momento lo marca Compras con el
-- interruptor compras.revision_almacen encendido).
-- ============================================================

alter table public.ordenes add column if not exists retencion_previa jsonb;
comment on column public.ordenes.retencion_previa is
  'Retención hecha ANTES de pagar (flujo nuevo): {bs, usd, tasa, monto (en la moneda de la OC)}. Tesorería la resta al pagar.';

drop function if exists public.compras_marcar_retencion(uuid, text);

create or replace function public.compras_marcar_retencion(
  p_orden_id uuid, p_nota text default null,
  p_monto_bs numeric default null, p_monto_usd numeric default null, p_tasa numeric default null
)
returns public.ordenes
language plpgsql security definer set search_path = '' as $$
declare
  v_o public.ordenes; v_email text; v_prev jsonb := null; v_monto numeric;
begin
  if not (public.is_admin() or public.puede_modulo('retenciones', 'escritura')) then
    raise exception 'Sin permiso de escritura en Retenciones.' using errcode = '42501';
  end if;
  select * into v_o from public.ordenes where id = p_orden_id for update;
  if v_o.id is null then raise exception 'No se encontró la orden.' using errcode = '23503'; end if;
  if v_o.retencion_momento is null then
    raise exception 'La orden % no espera retención en este flujo.', coalesce(v_o.oc_codigo, v_o.codigo) using errcode = 'P0001';
  end if;
  if v_o.retencion_hecha_en is not null then
    raise exception 'La retención de % ya estaba marcada.', coalesce(v_o.oc_codigo, v_o.codigo) using errcode = 'P0001';
  end if;
  if v_o.retencion_momento = 'despues' and v_o.estado <> 'pagada' then
    raise exception 'La orden % se retiene después de pagar y todavía no está pagada.', coalesce(v_o.oc_codigo, v_o.codigo) using errcode = 'P0001';
  end if;

  -- Antes de pagar: el monto retenido (en la moneda de la OC) es lo que Tesorería resta.
  if v_o.retencion_momento = 'antes' and (coalesce(p_monto_bs, 0) > 0 or coalesce(p_monto_usd, 0) > 0) then
    v_monto := round(case when upper(coalesce(v_o.moneda, 'USD')) in ('BS', 'VES') then coalesce(p_monto_bs, 0) else coalesce(p_monto_usd, 0) end, 2);
    if v_monto <= 0 then
      raise exception 'Indica la retención en la moneda de la orden (%).', coalesce(v_o.moneda, 'USD') using errcode = 'P0001';
    end if;
    if v_monto >= coalesce(v_o.total, 0) then
      raise exception 'La retención no puede ser igual o mayor que el total de la orden.' using errcode = 'P0001';
    end if;
    v_prev := jsonb_build_object('bs', round(coalesce(p_monto_bs, 0), 2), 'usd', round(coalesce(p_monto_usd, 0), 2),
                                 'tasa', p_tasa, 'monto', v_monto);
  end if;

  select email into v_email from public.usuarios where id = auth.uid();
  update public.ordenes set
    retencion_hecha_en = now(),
    retencion_hecha_por = v_email,
    retencion_nota = nullif(btrim(coalesce(p_nota, '')), ''),
    retencion_previa = v_prev,
    historial = coalesce(historial, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'at', now(), 'evento', 'retencion_hecha', 'actor', v_email, 'retencion_previa', v_prev,
      'detalle', case when v_o.retencion_momento = 'antes'
        then 'Retenida antes de pagar: pasa a Tesorería' || case when v_prev is not null then ' (Tesorería paga el total menos ' || (v_prev->>'monto') || ')' else '' end
        else 'Retenida después de pagar' end))
  where id = p_orden_id returning * into v_o;
  return v_o;
end $$;
revoke all on function public.compras_marcar_retencion(uuid, text, numeric, numeric, numeric) from public, anon;
grant execute on function public.compras_marcar_retencion(uuid, text, numeric, numeric, numeric) to authenticated;
