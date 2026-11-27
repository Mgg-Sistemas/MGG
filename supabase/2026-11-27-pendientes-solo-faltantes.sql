begin;
create or replace function public.compras_pendientes_cotizar()
returns table(id uuid,codigo text,items jsonb,notas text,cotizacion_pendiente_origen_id uuid,created_at timestamptz)
language sql stable security invoker set search_path=public,pg_temp as $$
 select o.id,o.codigo,p.items,o.notas,coalesce(o.cotizacion_pendiente_origen_id,o.reposicion_origen_id),o.created_at
 from public.ordenes o
 cross join lateral(
  select jsonb_agg(i||jsonb_build_object('cantidad',(i->>'cantidad')::numeric-c.cantidad)) as items
  from jsonb_array_elements(o.items) i
  cross join lateral(
   select coalesce(sum((j->>'cantidad')::numeric),0) cantidad from public.ordenes h
   cross join lateral jsonb_array_elements(h.items) j
   where h.parent_orden_id=o.id and h.estado::text not in ('cancelada','anulada','rechazada','reasignada')
     and j->>'sku'=i->>'sku' and coalesce(j->>'comprar','true')<>'false'
     and (case when coalesce(h.pago_en_divisa,false) and nullif(j->>'precio_usd','') is not null
       then (j->>'precio_usd')::numeric else coalesce((j->>'precio')::numeric,0) end)>0
  ) c
  where coalesce(i->>'comprar','true')<>'false' and (i->>'cantidad')::numeric>c.cantidad
 ) p
 where o.estado::text='aprobada' and o.oc_codigo is null and coalesce(o.clase,'producto')='producto'
 and (o.cotizacion_pendiente_origen_id is not null or o.reposicion_origen_id is not null)
 and p.items is not null
 order by o.created_at desc,o.id;
$$;
revoke all on function public.compras_pendientes_cotizar() from public;
grant execute on function public.compras_pendientes_cotizar() to authenticated;
notify pgrst,'reload schema';
commit;