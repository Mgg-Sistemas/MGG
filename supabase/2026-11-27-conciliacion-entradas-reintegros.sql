begin;
create or replace function public.conciliacion_entradas_reintegros()
returns table(id uuid,orden_id uuid,movimiento_id uuid,fecha timestamptz,monto numeric,moneda text,caja text,cuenta text,referencia text,oc_codigo text,proveedor text,motivo text,nota_almacen text,comprobante text,conciliada_at timestamptz,detalle jsonb)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not (public.is_admin() or public.puede_modulo('conciliacion','lectura')) then raise exception 'Sin permiso de Conciliación'; end if;
 return query select r.id,r.orden_id,r.movimiento_id,m.at,m.monto::numeric,m.moneda::text,c.nombre::text,m.cuenta::text,r.referencia::text,
 coalesce(o.oc_codigo,o.codigo)::text,coalesce(p.razon_social,'Sin proveedor')::text,r.motivo::text,o.nota_recepcion::text,r.comprobante_url::text,
 nullif(to_jsonb(m)->>'conciliada_at','')::timestamptz,r.detalle
 from public.compras_reintegros r join public.movimientos_caja m on m.id=r.movimiento_id
 join public.ordenes o on o.id=r.orden_id left join public.proveedores p on p.id=o.proveedor_id left join public.cajas c on c.id=m.caja_id
 where r.estado='recibido' and m.tipo::text='ingreso' and m.categoria='reintegro_proveedor'
 and to_jsonb(m)->>'revertido_en' is null and to_jsonb(m)->>'reverso_de_id' is null
 order by m.at desc,r.id;
end $$;
revoke all on function public.conciliacion_entradas_reintegros() from public;
grant execute on function public.conciliacion_entradas_reintegros() to authenticated;
notify pgrst,'reload schema';
commit;
