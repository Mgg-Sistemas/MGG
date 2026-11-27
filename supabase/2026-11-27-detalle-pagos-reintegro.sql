begin;
create or replace function public.compras_pagos_detalle_reintegro(p_orden uuid)
returns table(fecha timestamptz,monto numeric,moneda text)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not (public.is_admin() or public.puede_modulo('pedidos','lectura') or public.puede_modulo('tesoreria','lectura')) then raise exception 'Sin permiso para consultar el pago'; end if;
 return query select m.at,m.monto::numeric,m.moneda::text from public.movimientos_caja m
 where m.ref_orden_id=p_orden and m.tipo::text='salida' and m.categoria in ('pago_oc','reembolso_oc')
 and m.revertido_en is null and m.reverso_de_id is null
 and not exists(select 1 from public.movimientos_caja r where r.reverso_de_id=m.id)
 order by m.at desc,m.id;
end $$;
revoke all on function public.compras_pagos_detalle_reintegro(uuid) from public;
grant execute on function public.compras_pagos_detalle_reintegro(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
