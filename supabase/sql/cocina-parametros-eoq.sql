/* Cocina · Control de distribución (modelo EOQ) — 21-09-2026.
   Parámetros del lote óptimo por cocina. Son de la COCINA (no del víver): el costo de
   emitir una orden, el de almacenar y el tiempo de entrega dependen de quién compra y
   de dónde queda el centro. Los valores por defecto son los de la planilla de Excel. */
alter table public.cocinas
  add column if not exists eoq_costo_orden numeric not null default 3.33,
  add column if not exists eoq_costo_almacenar numeric not null default 1.2,
  add column if not exists eoq_lead_time_dias integer not null default 2;

comment on column public.cocinas.eoq_costo_orden is 'S · costo de emitir una orden de compra ($)';
comment on column public.cocinas.eoq_costo_almacenar is 'H · costo de almacenar una unidad durante un año ($/unidad·año)';
comment on column public.cocinas.eoq_lead_time_dias is 'L · días que tarda en llegar el pedido';

select json_agg(json_build_object('cocina', nombre, 'S', eoq_costo_orden, 'H', eoq_costo_almacenar, 'L', eoq_lead_time_dias)) from public.cocinas;
