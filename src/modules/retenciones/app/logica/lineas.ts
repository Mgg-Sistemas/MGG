/* ============================================================
   MGG · Retenciones · Varias líneas por factura

   El ISLR va con una línea por concepto y el ISAE con una línea por
   actividad, cada una con su % (decisión del usuario, 14/10 10:14). El
   comprobante lleva una fila por línea y su total.

   El sustraendo y el mínimo del ISLR, «por concepto» por defecto (usuario,
   14/10 13:27): cada línea resta su sustraendo con su % y se compara con su
   propio mínimo. «Una vez por factura» queda como opción, sin programar:
   el mínimo se compara con la base de toda la factura y se resta un solo
   sustraendo, el del concepto de la primera línea.
   ============================================================ */

import { ejecutarRegla, type ActividadVigente, type ConceptoVigente, type ContextoRegla, type EntradaRegla, type FaltaDato, type PasoCalculo, type PiezasRegla } from './regla';
import { r2 } from './numeros';

export type ModoSustraendo = 'linea' | 'factura';

export interface LineaEntrada {
  base: number;
  concepto?: ConceptoVigente | null;
  actividad?: ActividadVigente | null;
}

export interface LineaCalculada {
  /** El código del concepto o de la actividad. */
  clave: string;
  descripcion: string;
  base: number;
  porcentaje: number;
  monto: number;
  nota: string;
  falta: FaltaDato | null;
  pasos: PasoCalculo[];
}

export interface ResultadoLineas {
  estado: 'calculado' | 'sin_dato';
  lineas: LineaCalculada[];
  total: number;
}

export function calcularLineas(
  piezas: PiezasRegla, factura: EntradaRegla, lineas: readonly LineaEntrada[], ctx: ContextoRegla,
  opciones: { modoSustraendo?: ModoSustraendo } = {},
): ResultadoLineas {
  const porFactura = opciones.modoSustraendo === 'factura' && (piezas.sustraendo === 'formula' || piezas.minimo === 'ut');
  const piezasLinea: PiezasRegla = porFactura ? { ...piezas, sustraendo: 'ninguno', minimo: 'ninguno' } : piezas;

  const calculadas: LineaCalculada[] = lineas.map((l) => {
    const concepto = l.concepto ?? null, actividad = l.actividad ?? null;
    const r = ejecutarRegla(piezasLinea, { ...factura, base: l.base, pagado: l.base, concepto, actividad }, ctx);
    return {
      clave: concepto?.codigo ?? actividad?.codigo ?? '',
      descripcion: concepto?.nombre ?? actividad?.descripcion ?? '',
      base: l.base,
      porcentaje: concepto?.porcentaje ?? actividad?.porcentaje ?? piezas.fijo ?? 0,
      monto: r.monto ?? 0,
      nota: r.nota,
      falta: r.estado === 'sin_dato' ? r.falta : null,
      pasos: r.pasos,
    };
  });
  if (calculadas.some((l) => l.falta)) return { estado: 'sin_dato', lineas: calculadas, total: 0 };
  if (porFactura) {
    const resultado = aplicarUnaVez(piezas, lineas, calculadas, ctx);
    if (resultado) return resultado;
  }
  return { estado: 'calculado', lineas: calculadas, total: r2(calculadas.reduce((a, l) => a + l.monto, 0)) };
}

/** «Una vez por factura»: el mínimo con la base total y un solo sustraendo, el de la primera línea. */
function aplicarUnaVez(piezas: PiezasRegla, lineas: readonly LineaEntrada[], calculadas: LineaCalculada[], ctx: ContextoRegla): ResultadoLineas | null {
  const primero = lineas[0]?.concepto;
  const ut = ctx.ut && ctx.ut > 0 ? ctx.ut : null;
  if (!primero) return null;
  const necesitaUt = (piezas.minimo === 'ut' && primero.minimoUt > 0) || (piezas.sustraendo === 'formula' && primero.aplicaSustraendo);
  if (necesitaUt && !ut) {
    const sinUt = calculadas.map((l) => ({ ...l, monto: 0, falta: 'ut' as const, nota: 'Sin valor de UT para la fecha. Registrar la UT en ⚙ Parámetros. No se calcula.' }));
    return { estado: 'sin_dato', lineas: sinUt, total: 0 };
  }
  const baseTotal = lineas.reduce((a, l) => a + l.base, 0);
  if (piezas.minimo === 'ut' && primero.minimoUt > 0 && ut && baseTotal < r2(ut * primero.minimoUt)) {
    const ceros = calculadas.map((l) => ({ ...l, monto: 0, nota: 'No se retiene: la base de la factura no llega al mínimo.' }));
    return { estado: 'calculado', lineas: ceros, total: 0 };
  }
  let resta = piezas.sustraendo === 'formula' && primero.aplicaSustraendo && ut
    ? r2((primero.porcentaje / 100) * ut * (piezas.factor ?? 83.3334)) : 0;
  const conSustraendo = calculadas.map((l) => {
    const quita = Math.min(l.monto, resta);
    resta = r2(resta - quita);
    return { ...l, monto: r2(l.monto - quita) };
  });
  return { estado: 'calculado', lineas: conSustraendo, total: r2(conSustraendo.reduce((a, l) => a + l.monto, 0)) };
}

/** Reparte un monto según unos pesos (por ejemplo, 60 y 40); la última parte absorbe el redondeo. */
export function repartirBase(total: number, pesos: readonly number[]): number[] {
  const suma = pesos.reduce((a, p) => a + p, 0);
  if (!pesos.length || suma <= 0) return pesos.map(() => 0);
  const partes = pesos.slice(0, -1).map((p) => r2((total * p) / suma));
  return [...partes, r2(total - partes.reduce((a, p) => a + p, 0))];
}

export type BloqueoActividad = { bloquea: false } | { bloquea: true; codigo: string | null; motivo: string };

/** Sin la actividad del ISAE, o con una que no está en el catálogo, el ISAE de la factura no se registra (14/10 10:25). */
export function bloqueoActividad(codigo: string | null, catalogo: ReadonlyMap<string, ActividadVigente>): BloqueoActividad {
  if (!codigo) return { bloquea: true, codigo: null, motivo: 'Por definir: falta la actividad del ISAE del proveedor.' };
  if (!catalogo.has(codigo)) {
    return { bloquea: true, codigo, motivo: `No se registra: la actividad ${codigo} del proveedor no está en el catálogo de actividades del ISAE, y sin ella no hay alícuota.` };
  }
  return { bloquea: false };
}
