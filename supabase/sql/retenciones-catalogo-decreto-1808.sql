/* ============================================================
   MGG · Retenciones · Catálogo de conceptos — 21/09/2026

   Siembra el catálogo con los conceptos de ISLR del Decreto 1.808
   (Reglamento Parcial de la Ley de ISLR en materia de retenciones) y deja
   preparados —VACÍOS— los renglones municipal y estadal.

   POR QUÉ MUNICIPAL Y ESTADAL NACEN EN CERO
   La alícuota del Impuesto sobre Actividades Económicas la fija la ORDENANZA
   de cada municipio, y el timbre fiscal la ley de cada estado. No existe un
   porcentaje nacional que se pueda sembrar sin mentir. Quedan creados con 0%
   y desactivados: la empresa carga el suyo desde ⚙ Configuración fiscal.

   TODOS LOS PORCENTAJES SON EDITABLES
   Cada concepto guarda su `fundamento` (de dónde sale el número) para poder
   contrastarlo contra el decreto vigente antes de emitir un comprobante.
   ============================================================ */
begin;

insert into public.retencion_conceptos (tipo, codigo, nombre, sujeto, porcentaje, base_pct, aplica_sustraendo, base_minima_ut, fundamento, activo, orden)
values
  /* ── ISLR · personas naturales residentes ──
     Decreto 1.808, art. 9: la retención se calcula sobre el pago y se le resta
     el SUSTRAENDO (= % × UT × 83,3334). No se retiene por debajo del mínimo. */
  ('islr', '001', 'Honorarios profesionales',                        'pn_residente',    3, 100, true,  83.3334, 'Decreto 1.808, art. 9 num. 1', true, 10),
  ('islr', '002', 'Comisiones mercantiles',                          'pn_residente',    3, 100, true,  83.3334, 'Decreto 1.808, art. 9 num. 2', true, 20),
  ('islr', '003', 'Intereses de capitales',                          'pn_residente',    3, 100, true,  83.3334, 'Decreto 1.808, art. 9 num. 3', true, 30),
  ('islr', '004', 'Arrendamiento de bienes inmuebles',               'pn_residente',    3, 100, true,  83.3334, 'Decreto 1.808, art. 9 num. 4', true, 40),
  ('islr', '005', 'Arrendamiento de bienes muebles',                 'pn_residente',    3, 100, true,  83.3334, 'Decreto 1.808, art. 9 num. 5', true, 50),
  ('islr', '006', 'Publicidad y propaganda',                         'pn_residente',    3, 100, true,  83.3334, 'Decreto 1.808, art. 9 num. 11', true, 60),
  ('islr', '007', 'Fletes · transporte nacional de bienes',          'pn_residente',    1, 100, true,  83.3334, 'Decreto 1.808, art. 9 num. 12', true, 70),
  ('islr', '008', 'Contratistas y subcontratistas de obras o servicios', 'pn_residente', 1, 100, true, 83.3334, 'Decreto 1.808, art. 9 num. 11', true, 80),
  ('islr', '009', 'Primas de seguros y reaseguros',                  'pn_residente',    3, 100, true,  83.3334, 'Decreto 1.808, art. 9 num. 10', true, 90),

  /* ── ISLR · personas jurídicas domiciliadas ──
     Sin sustraendo y sin mínimo: el porcentaje se aplica directo sobre el pago. */
  ('islr', '001', 'Honorarios profesionales',                        'pj_domiciliada',  5, 100, false, 0, 'Decreto 1.808, art. 9 num. 1', true, 110),
  ('islr', '002', 'Comisiones mercantiles',                          'pj_domiciliada',  5, 100, false, 0, 'Decreto 1.808, art. 9 num. 2', true, 120),
  ('islr', '003', 'Intereses de capitales',                          'pj_domiciliada',  5, 100, false, 0, 'Decreto 1.808, art. 9 num. 3', true, 130),
  ('islr', '004', 'Arrendamiento de bienes inmuebles',               'pj_domiciliada',  5, 100, false, 0, 'Decreto 1.808, art. 9 num. 4', true, 140),
  ('islr', '005', 'Arrendamiento de bienes muebles',                 'pj_domiciliada',  5, 100, false, 0, 'Decreto 1.808, art. 9 num. 5', true, 150),
  ('islr', '006', 'Publicidad y propaganda',                         'pj_domiciliada',  5, 100, false, 0, 'Decreto 1.808, art. 9 num. 11', true, 160),
  ('islr', '007', 'Fletes · transporte nacional de bienes',          'pj_domiciliada',  3, 100, false, 0, 'Decreto 1.808, art. 9 num. 12', true, 170),
  ('islr', '008', 'Contratistas y subcontratistas de obras o servicios', 'pj_domiciliada', 2, 100, false, 0, 'Decreto 1.808, art. 9 num. 11', true, 180),
  ('islr', '009', 'Primas de seguros y reaseguros',                  'pj_domiciliada',  5, 100, false, 0, 'Decreto 1.808, art. 9 num. 10', true, 190),

  /* ── ISLR · no domiciliados / no residentes ──
     Se retiene sobre una porción del ingreso bruto y a la tarifa que manda la
     ley. Quedan como punto de partida: confirmar el caso antes de usarlos. */
  ('islr', '020', 'Honorarios profesionales a no residentes',        'pn_no_residente', 34, 90, false, 0, 'Decreto 1.808, art. 9 num. 1 lit. b', true, 210),
  ('islr', '021', 'Servicios de empresas no domiciliadas',           'pj_no_domiciliada', 34, 100, false, 0, 'Ley de ISLR, art. 52 · tarifa 2', true, 220),
  ('islr', '022', 'Transporte internacional',                        'pj_no_domiciliada', 34, 5, false, 0, 'Ley de ISLR, art. 30 · 5% del ingreso bruto', true, 230),

  /* ── Municipal (ISAE) y estadal (timbre fiscal) ──
     En 0% y desactivados a propósito: el número sale de la ordenanza. */
  ('municipal', 'ISAE', 'Impuesto sobre Actividades Económicas (ordenanza del municipio)', 'todos', 0, 100, false, 0, 'Ordenanza municipal · cargar la alícuota vigente', false, 310),
  ('regional', 'TIMBRE', 'Timbre fiscal estadal', 'todos', 0, 100, false, 0, 'Ley de timbre fiscal del estado · cargar la tarifa vigente', false, 410)
on conflict do nothing;

commit;

select tipo, sujeto, count(*) conceptos, count(*) filter (where activo) activos
from public.retencion_conceptos group by 1, 2 order by 1, 2;
