-- ============================================================
-- Compras · el IVA de la cotización aceptada se sincroniza SOLO a las sub-OC
-- (26-10-2026, pedido de la administradora: «haz esto automático»)
--
-- Hasta hoy `sync_orden_total_desde_oferta` solo copiaba IVA/IGTF/ajuste a la
-- orden DIRECTA en «OC creada» y dejaba las hijas (sub-OC por proveedor) al
-- front, que solo las tocaba al editar la oferta desde la hija. Si la
-- cotización se cargaba sin IVA y se corregía después, o si nacía sin él (caso
-- cotizada solo en divisa), la OC quedaba pendiente por pagar con el IVA en 0.
--
-- Ahora, cada vez que se guarda la oferta ACEPTADA de un proveedor, sus sub-OC
-- vivas y aún no pagadas (OC creada · confirmada · aprobada; sin abonos ni
-- movimiento de caja) reciben la parte que les toca: misma regla que el front
-- (recortarOfertaAHija): fracción = lo que la hija compra de la cotización ÷
-- total cotizado, medido con el precio BCV o, si solo se cotizó en $, el de
-- divisa. El total de la hija se arma desde SUS renglones (si se pagó en
-- divisa ya están repreciados), así no se pisa ni se desalinea nada:
--   total = (Σ renglones − descuento·f) + IVA·f (salvo incluido) + IGTF·f + ajuste·f
-- Solo escribe si algo cambió y deja el evento en la línea de tiempo.
-- ============================================================
create or replace function public.sync_orden_total_desde_oferta()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  nuevo_total numeric;
  h record;
  inc boolean;
  gross_of numeric;
  gross_parte numeric;
  sub_h numeric;
  frac numeric;
  iva_h numeric; igtf_h numeric; desc_h numeric; aj_h numeric; tot_h numeric;
begin
  -- Solo la oferta ACEPTADA define el total de la OC.
  if NEW.estado is distinct from 'aceptada' then
    return NEW;
  end if;

  -- total = (base − descuento) + IVA (salvo que los precios ya lo traigan) + IGTF + ajuste
  nuevo_total := round(
    greatest(0, coalesce(NEW.precio_efectivo, NEW.precio_total, 0) - coalesce(NEW.descuento, 0))
    + (case when coalesce(NEW.iva_incluido, false) then 0 else coalesce(NEW.iva, 0) end)
    + coalesce(NEW.igtf, 0)
    + coalesce(NEW.ajuste, 0)
  , 2);

  -- Caso directo (un solo proveedor): la propia orden de la oferta está en oc_creada.
  update ordenes o
     set total = nuevo_total,
         iva = NEW.iva,
         igtf = NEW.igtf,
         iva_incluido = coalesce(NEW.iva_incluido, false),
         ajuste = NEW.ajuste,
         ajuste_motivo = NEW.ajuste_motivo,
         descuento_obtenido = NEW.descuento,
         oferta_precio_efectivo = NEW.precio_efectivo
   where o.id = NEW.orden_id
     and o.estado = 'oc_creada';

  -- Sub-OC (hijas) de ESTE proveedor, vivas y sin pagar: su parte prorrateada.
  inc := coalesce(NEW.iva_incluido, false);
  select coalesce(sum((i->>'cantidad')::numeric * coalesce(nullif((i->>'precio')::numeric, 0), (i->>'precio_usd')::numeric, 0)), 0)
    into gross_of
    from jsonb_array_elements(coalesce(NEW.items, '[]'::jsonb)) i
   where coalesce((i->>'comprar')::boolean, true);
  if coalesce(NEW.precio_total, 0) > 0 then gross_of := round(NEW.precio_total, 2); end if;

  for h in
    select o.* from ordenes o
     where o.parent_orden_id = NEW.orden_id
       and o.proveedor_id = NEW.proveedor_id
       and o.estado in ('oc_creada', 'confirmada_metodo', 'oc_aprobada')
       and coalesce(o.abonado_total, 0) = 0
       and o.caja_mov_id is null
  loop
    select coalesce(sum((i->>'cantidad')::numeric * (i->>'precio')::numeric), 0) into sub_h
      from jsonb_array_elements(coalesce(h.items, '[]'::jsonb)) i
     where coalesce((i->>'comprar')::boolean, true);
    select coalesce(sum((i->>'cantidad')::numeric * coalesce(nullif((i->>'precio')::numeric, 0), (i->>'precio_usd')::numeric, 0)), 0)
      into gross_parte
      from jsonb_array_elements(coalesce(NEW.items, '[]'::jsonb)) i
     where coalesce((i->>'comprar')::boolean, true)
       and (i->>'sku') in (select j->>'sku' from jsonb_array_elements(coalesce(h.items, '[]'::jsonb)) j);
    if gross_of > 0 then frac := least(1, gross_parte / gross_of);
    elsif gross_parte > 0 then frac := 1;
    else frac := 0; end if;
    if frac <= 0 then continue; end if;

    iva_h  := nullif(round(coalesce(NEW.iva, 0) * frac, 2), 0);
    igtf_h := nullif(round(coalesce(NEW.igtf, 0) * frac, 2), 0);
    desc_h := nullif(round(coalesce(NEW.descuento, 0) * frac, 2), 0);
    aj_h   := nullif(round(coalesce(NEW.ajuste, 0) * frac, 2), 0);
    tot_h  := round(greatest(0, sub_h - coalesce(desc_h, 0))
              + (case when inc then 0 else coalesce(iva_h, 0) end)
              + coalesce(igtf_h, 0) + coalesce(aj_h, 0), 2);

    if h.iva is distinct from iva_h or h.igtf is distinct from igtf_h
       or coalesce(h.iva_incluido, false) <> inc or h.ajuste is distinct from aj_h
       or h.descuento_obtenido is distinct from desc_h or round(coalesce(h.total, 0), 2) <> tot_h then
      update ordenes
         set iva = iva_h, igtf = igtf_h, iva_incluido = inc, ajuste = aj_h,
             ajuste_motivo = case when aj_h is not null then NEW.ajuste_motivo else null end,
             descuento_obtenido = desc_h, total = tot_h,
             historial = coalesce(historial, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
               'at', now(), 'evento', 'oc_editada',
               'actor', coalesce(NEW.decidida_por_email, NEW.registrada_por_email, 'sistema'),
               'motivo', 'Sincronización automática de IVA y total desde la cotización aceptada',
               'iva', coalesce(iva_h, 0), 'total', tot_h))
       where id = h.id;
    end if;
  end loop;
  return NEW;
end;
$function$;

-- Una pasada ahora sobre todas las cotizaciones aceptadas que tienen sub-OC pendientes:
-- vuelve a guardar la oferta (sin cambiarla) para que el disparador las empareje.
create temp table antes as
  select id, codigo, total, iva from ordenes where parent_orden_id is not null and estado in ('oc_creada','confirmada_metodo','oc_aprobada');
update ofertas_proveedor f set estado = 'aceptada'
 where f.estado = 'aceptada'
   and exists (select 1 from ordenes h where h.parent_orden_id = f.orden_id and h.proveedor_id = f.proveedor_id
                 and h.estado in ('oc_creada','confirmada_metodo','oc_aprobada') and coalesce(h.abonado_total,0) = 0 and h.caja_mov_id is null);
select a.codigo, a.total total_antes, o.total total_ahora, a.iva iva_antes, o.iva iva_ahora
  from antes a join ordenes o on o.id = a.id
 where a.total is distinct from o.total or a.iva is distinct from o.iva order by a.codigo;
