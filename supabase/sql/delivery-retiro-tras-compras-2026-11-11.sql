-- ============================================================
-- MGG · Delivery · el retiro en Los Pinos sale SOLO cuando Compras confirma (11-11-2026)
--
-- SP-2026-0255 apareció «Por tomar» como Retiro Los Pinos a las 12:20 p. m.,
-- apenas el almacén la revisó, y Compras la aprobó recién a las 2:18 p. m.
-- La administradora: «solo debe salir cuando los de compras lo confirman».
-- Ahora el retiro exige además que Compras la haya aprobado (aprobada_en).
-- Los retiros ya tomados por un delivery no se tocan.
-- ============================================================
create or replace function public.delivery_retiro_disponible(o public.ordenes)
 returns boolean
 language sql
 stable
 set search_path to ''
as $function$
  select o.revisada_almacen_en is not null
     and o.revisada_almacen_en >= timestamptz '2026-11-03 00:00:00-04'
     and o.aprobada_en is not null
     and o.estado not in ('pendiente', 'revision_almacen', 'anulada', 'cancelada', 'rechazada', 'desistida_proveedor')
     and jsonb_array_length(public.delivery_items_retiro(o.items)) > 0;
$function$;

select o.codigo, o.estado from public.ordenes o where public.delivery_retiro_disponible(o) order by o.codigo desc limit 10;
