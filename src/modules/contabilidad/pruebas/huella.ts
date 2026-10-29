/* ============================================================
   MGG · Contabilidad · Forma canónica de los comprobantes (para pruebas)

   La MISMA que arma _herramientas/contabilidad/convertir-datos-bd.mjs
   sobre los comprobantes esperados del Carril BD: si la maqueta produce
   exactamente lo esperado, las dos formas dan la misma huella sha256.
   Montos a 2 decimales, tasas a 6, códigos en vez de ids.
   ============================================================ */

import type { EstadoSimulacion } from '../tipos';

const f = (x: number | null | undefined, n: number) => (x ?? 0).toFixed(n);

export function formaCanonica(e: EstadoSimulacion): string {
  const cuenta = new Map(e.cont_cuentas.map((x) => [x.id, x.codigo]));
  const centro = new Map(e.cont_centros_costo.map((x) => [x.id, x.codigo]));
  const aux = new Map(e.cont_auxiliares.map((x) => [x.id, x.codigo]));
  const tipo = new Map(e.cont_tipos_comprobante.map((x) => [x.id, x.codigo]));
  const periodo = new Map(e.cont_periodos.map((x) => [x.id, x.codigo]));
  const regla = new Map(e.cont_reglas.map((x) => [x.id, x.codigo]));
  const codigo = new Map(e.cont_comprobantes.map((x) => [x.id, x.codigo]));
  const lineas = new Map<string, typeof e.cont_comprobante_lineas>();
  for (const l of e.cont_comprobante_lineas) lineas.set(l.comprobante_id, [...(lineas.get(l.comprobante_id) ?? []), l]);

  return JSON.stringify([...e.cont_comprobantes]
    .sort((a, b) => a.codigo.localeCompare(b.codigo))
    .map((c) => [
      c.codigo, tipo.get(c.tipo_id), periodo.get(c.periodo_id), c.fecha, c.concepto, c.estado, c.origen, f(c.tasa, 6),
      c.regla_id ? regla.get(c.regla_id) : null, c.origen_tabla === 'hechos_simulados' ? c.origen_id : null,
      c.origen_ref ?? null, c.reverso_de_id ? codigo.get(c.reverso_de_id) : null, c.numero_lote ?? null, c.modificado,
      JSON.stringify(c.historial),
      f(c.total_debe_ves, 2), f(c.total_haber_ves, 2), f(c.total_debe_usd, 2), f(c.total_haber_usd, 2),
      (lineas.get(c.id) ?? []).sort((a, b) => a.renglon - b.renglon).map((l) => [
        cuenta.get(l.cuenta_id), l.referencia ?? null, l.centro_costo_id ? centro.get(l.centro_costo_id) : null,
        l.auxiliar_id ? aux.get(l.auxiliar_id) : null, l.descripcion ?? null, l.moneda,
        f(l.monto_moneda, 2), f(l.tasa, 6), f(l.debe_ves, 2), f(l.haber_ves, 2), f(l.debe_usd, 2), f(l.haber_usd, 2),
      ]),
    ]));
}
