-- ============================================================
-- MGG · Delivery · ver el comprobante de pago de Tesorería (30-10-2026)
-- El motorizado verifica, antes de ir al proveedor, que la OC de verdad se pagó.
-- Devuelve solo lo del pago (eventos «pagada» del historial: comprobante y montos),
-- no la OC entera. El archivo está en el bucket compras-oc, que ya leen los
-- usuarios activos (oc_obj_read = is_operativo()).
-- ============================================================

create or replace function public.delivery_comprobante_pago(p_orden_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_o record;
begin
  if not public.delivery_puede('lectura') then
    raise exception 'No tienes permiso en Delivery.' using errcode = '42501';
  end if;

  select o.id, o.oc_codigo, o.estado, o.pagada_en, o.historial
    into v_o
    from public.ordenes o where o.id = p_orden_id;
  if not found then
    raise exception 'La orden no existe.';
  end if;
  if v_o.pagada_en is null
     and not exists (select 1 from public.delivery_pedidos d where d.orden_id = p_orden_id) then
    raise exception 'Esta orden todavía no está pagada.';
  end if;

  return jsonb_build_object(
    'id', v_o.id,
    'oc_codigo', v_o.oc_codigo,
    'pagada_en', v_o.pagada_en,
    'historial', coalesce((
      select jsonb_agg(jsonb_build_object(
        'evento', 'pagada',
        'at', e->'at',
        'comprobante_path', e->'comprobante_path',
        'comprobante_nombre', e->'comprobante_nombre',
        'multipago', e->'multipago'
      ))
      from jsonb_array_elements(coalesce(v_o.historial, '[]'::jsonb)) e
      where e->>'evento' = 'pagada'
    ), '[]'::jsonb)
  );
end $$;

revoke all on function public.delivery_comprobante_pago(uuid) from public, anon;
grant execute on function public.delivery_comprobante_pago(uuid) to authenticated;
