-- ============================================================
-- Compras · sub-OC que nacieron SIN el IVA de su cotización (26-10-2026)
--
-- Cuando la cotización se carga SOLO en divisa (precio_usd) el precio BCV de
-- cada renglón queda en 0. Al crear la sub-OC, el recorte de la oferta a la
-- hija (recortarOfertaAHija) sumaba los renglones por el precio BCV → 0 → la
-- fracción de la hija era 0 y el IVA/IGTF/ajuste se prorrateaban a nada. La
-- OC quedaba con total = solo renglones y el kanban no mostraba «incl. IVA».
-- El front se corrigió (toma el precio que haya: BCV o USD). Esto repara las
-- 4 OC ya creadas así, que están pendientes por pagar y sin abonos.
-- ============================================================
with objetivo as (
  select o.id, o.codigo, o.historial,
         f.iva of_iva, coalesce(f.iva_incluido,false) of_inc, f.igtf of_igtf, f.ajuste of_aj, f.ajuste_motivo of_ajm,
         (select round(coalesce(sum((i->>'cantidad')::numeric * (i->>'precio')::numeric),0),2)
            from jsonb_array_elements(o.items) i where coalesce((i->>'comprar')::boolean, true)) sub
  from ordenes o
  join ordenes m on m.id = o.parent_orden_id
  join ofertas_proveedor f on f.orden_id = m.id and f.estado = 'aceptada' and f.proveedor_id = o.proveedor_id
  where o.codigo in ('SP-2026-0204-1','SP-2026-0208-1','SP-2026-0209-1','SP-2026-0210-1')
    and o.estado in ('oc_creada','oc_aprobada','confirmada_metodo')
    and coalesce(o.abonado_total,0) = 0 and o.caja_mov_id is null and o.iva is null
    and coalesce(f.iva,0) > 0
    -- una sola hija del proveedor: toda la cotización es de ella (fracción 1)
    and (select count(*) from ordenes h where h.parent_orden_id = m.id and h.proveedor_id = o.proveedor_id and h.estado not in ('cancelada','anulada')) = 1
)
update ordenes o
   set iva = t.of_iva,
       iva_incluido = t.of_inc,
       igtf = nullif(coalesce(t.of_igtf,0),0),
       ajuste = nullif(coalesce(t.of_aj,0),0),
       ajuste_motivo = case when coalesce(t.of_aj,0) <> 0 then t.of_ajm else null end,
       total = round(t.sub + (case when t.of_inc then 0 else t.of_iva end) + coalesce(t.of_igtf,0) + coalesce(t.of_aj,0), 2),
       historial = coalesce(t.historial,'[]'::jsonb) || jsonb_build_array(jsonb_build_object(
         'at', now(), 'evento', 'oc_editada', 'actor', 'sistema',
         'motivo', 'Sincronización de IVA y total desde la cotización (cotizada en divisa; corrección 26-10-2026)',
         'iva', t.of_iva,
         'total', round(t.sub + (case when t.of_inc then 0 else t.of_iva end) + coalesce(t.of_igtf,0) + coalesce(t.of_aj,0), 2)))
  from objetivo t
 where o.id = t.id;

select codigo, estado, total, iva, iva_incluido from ordenes
 where codigo in ('SP-2026-0204-1','SP-2026-0208-1','SP-2026-0209-1','SP-2026-0210-1') order by codigo;
