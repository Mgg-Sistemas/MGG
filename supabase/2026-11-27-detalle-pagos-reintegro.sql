begin;
create or replace function public.compras_pagos_detalle_reintegro(p_orden uuid)
returns table(fecha timestamptz,monto numeric,moneda text)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not (public.is_admin() or public.puede_modulo('pedidos','lectura') or public.puede_modulo('tesoreria','lectura')) then raise exception 'Sin permiso para consultar el pago'; end if;
 return query
 with reversos as (
  select m.caja_id,m.moneda,sum(m.monto) monto from public.movimientos_caja m
  where m.ref_orden_id=p_orden and m.tipo::text='ingreso' and m.categoria in ('pago_oc','reverso')
  group by m.caja_id,m.moneda
 ), egresos as (
  select m.id,m.at,m.monto,m.moneda,m.caja_id,
   coalesce(sum(m.monto) over(partition by m.caja_id,m.moneda order by m.at desc,m.id desc rows between unbounded preceding and 1 preceding),0) anteriores
  from public.movimientos_caja m where m.ref_orden_id=p_orden and m.tipo::text='salida' and m.categoria in ('pago_oc','reembolso_oc')
 ), vigentes as (
  select e.at,e.id,e.moneda,greatest(0,e.monto-greatest(0,coalesce(r.monto,0)-e.anteriores)) monto
  from egresos e left join reversos r on r.caja_id=e.caja_id and r.moneda=e.moneda
 ) select v.at,v.monto::numeric,v.moneda::text from vigentes v where v.monto>0 order by v.at desc,v.id;

end $$;
revoke all on function public.compras_pagos_detalle_reintegro(uuid) from public;
grant execute on function public.compras_pagos_detalle_reintegro(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
