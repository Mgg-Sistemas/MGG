-- ============================================================
-- MGG · Pedidos · Precios con el IVA adentro + ajuste frente a la factura (14-10-2026)
--
-- Caso: OC-2026-0186 (SP-2026-0184-1), SUPER HOME C.A., factura 11208 del 14-10-2026.
-- Es una factura de punto de venta: cada renglón trae el IVA adentro y el ticket
-- cierra con «sub total 2.459.781,10 · IVA 16 % 127.027,50 · total 2.586.808,60»
-- (Bs, a 877,90 = 2.801,90 + 144,69 = 2.946,59 $). La OC sumaba los renglones
-- tal cual (2.944,07) y no tenía IVA cargado: si se cargaba, el sistema lo SUMABA
-- otra vez; si no, la retención de IVA (75 %) no tenía de dónde salir.
--
-- Modelo (impuestosOc.ts): total = (Σ ítems − descuento) + IVA + IGTF + ajuste,
-- salvo iva_incluido = true: el IVA se guarda (retención, libro fiscal) y NO suma.
-- `ajuste` (con signo) es lo que la factura trae de más o de menos frente a los
-- renglones y ningún concepto explica (redondeo de precios unitarios), con motivo.
-- Idempotente. No borra datos.
-- ============================================================

alter table public.ofertas_proveedor
  add column if not exists iva_incluido boolean not null default false,
  add column if not exists ajuste numeric(14,2),
  add column if not exists ajuste_motivo text;

alter table public.ordenes
  add column if not exists iva_incluido boolean not null default false,
  add column if not exists ajuste numeric(14,2),
  add column if not exists ajuste_motivo text;

comment on column public.ofertas_proveedor.iva_incluido is 'true = los precios cotizados ya traen el IVA: iva se guarda pero no suma al total (impuestosOc.ts)';
comment on column public.ofertas_proveedor.ajuste is 'Diferencia declarada frente a la factura (con signo); suma al total';
comment on column public.ordenes.iva_incluido is 'true = los precios de los renglones ya traen el IVA: iva se guarda (retención) pero no suma al total';
comment on column public.ordenes.ajuste is 'Diferencia declarada frente a la factura (con signo); suma al total';

-- Trigger: la oferta ACEPTADA define el total de la OC directa (oc_creada). Misma fórmula.
create or replace function public.sync_orden_total_desde_oferta()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  nuevo_total numeric;
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

  -- Multiproveedor: las hijas NO se recalculan acá. Las crea AsignarProveedoresModal con
  -- su parte prorrateada, y las re-sincroniza el front al editar la oferta desde la hija
  -- (resincronizarOcDesdeOferta). Recalcularlas en SQL pisaba sub-OC en divisa y
  -- desalineaba total e ítems (ver docs/INFORME-BASE-DE-DATOS.md, frente 3).
  return NEW;
end;
$function$;

-- ─── Datos: OC-2026-0186 / SP-2026-0184-1 (SUPER HOME C.A.) como la factura 11208 ───
-- Renglones: 47, Σ 2.944,07 $ con el IVA adentro (23 cotejados centavo a centavo con el
-- ticket). Factura: 2.586.808,60 Bs ÷ 877,90 = 2.946,59 $; IVA 127.027,50 Bs = 144,69 $;
-- la diferencia de 2,52 $ es el redondeo a dos decimales de los precios unitarios.
update public.ofertas_proveedor
   set iva = 144.69,
       iva_incluido = true,
       ajuste = 2.52,
       ajuste_motivo = 'Redondeo de precios unitarios · factura 11208 del 14-10-2026 (2.586.808,60 Bs a 877,90)'
 where id = '9f93f37a-7779-4691-ac18-5ac37b474e2c'
   and orden_id = '058627c9-69f7-461f-a0f1-f510e8a720fd'
   and estado = 'aceptada';

update public.ordenes
   set total = 2946.59,
       iva = 144.69,
       iva_incluido = true,
       ajuste = 2.52,
       ajuste_motivo = 'Redondeo de precios unitarios · factura 11208 del 14-10-2026 (2.586.808,60 Bs a 877,90)',
       historial = coalesce(historial, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
         'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
         'evento', 'oc_editada',
         'actor', 'admin@gmail.com',
         'detalle', 'Ajustada a la factura 11208 de SUPER HOME (14-10-2026): los precios de los renglones ya traen el IVA (IVA 16 % = 144,69 $ / 127.027,50 Bs, base sin IVA 2.801,90 $ / 2.459.781,10 Bs) y se declara un ajuste de +2,52 $ por redondeo de precios unitarios; total 2.946,59 $ = 2.586.808,60 Bs a 877,90. Antes: 2.944,07 sin IVA cargado.'
       ))
 where id = '75efe339-fa80-4db2-8b00-990848268a14'
   and oc_codigo = 'OC-2026-0186'
   and estado = 'oc_creada';

-- Cotejo:
-- select codigo, oc_codigo, total, iva, iva_incluido, ajuste from ordenes where oc_codigo = 'OC-2026-0186';
--   → SP-2026-0184-1 · 2946.59 · 144.69 · true · 2.52
