import type { OfertaProveedor, PesosScore } from '@/shared/lib/types';
import { DEFAULT_PESOS_SCORE } from '@/shared/lib/types';
import type { ProveedorStats } from './evaluaciones.repository';

export interface ScoreBreakdown {
  total: number;          // 0..1
  precio: number;         // 0..1 normalizado dentro del grupo
  puntualidad: number;
  calidad: number;
  cumplimiento: number;
}

export interface ScoredOferta {
  oferta: OfertaProveedor;
  stats: ProveedorStats;
  score: ScoreBreakdown;
  recomendada: boolean;        // true para la de mejor score total
  mejorPrecio: boolean;
  masPuntual: boolean;
  mejorCalidad: boolean;
}

/** Lo mínimo de una oferta para saber cuánto se paga por ella. */
export type OfertaCotizada = Pick<
  OfertaProveedor,
  'precio_total' | 'precio_efectivo' | 'iva' | 'igtf' | 'descuento'
>;

/** Redondeo a 2 decimales: el monto de una factura no tiene colas largas. */
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Monto FINAL de una oferta, desglosado: lo que va a pagar Tesorería si se elige.
 *
 *   base − descuento negociado + IVA + IGTF
 *
 * La `base` es el precio en divisa efectivo cuando el proveedor da descuento por
 * pagar así (menor al BCV); si no, el total a BCV.
 *
 * El `descuento` (negociado con el proveedor) FALTABA en este cálculo. La
 * comparativa mostraba y ordenaba por la base sin restarlo, mientras el modal de
 * carga y `aprobarOrdenConOferta` sí lo restaban: la misma oferta valía dos cosas
 * distintas según la pantalla, y la barata podía perder contra una más cara.
 * Caso real SP-2026-0138: MULTIFERRE cotizó 63,00 con 5,00 de descuento —58,00 a
 * pagar— y el sistema recomendó otra oferta de 60,07 marcándola «Mejor precio».
 */
export function montoFinalOferta(o: OfertaCotizada): {
  base: number; descuento: number; impuestos: number; final: number;
} {
  const impuestos = r2((Number(o.iva) || 0) + (Number(o.igtf) || 0));
  const bcv = Number(o.precio_total) || 0;
  const efe = Number(o.precio_efectivo) || 0;
  // Qué precio manda: solo USD, solo Bs, o el menor de los dos cuando hay ambos.
  const base = r2(bcv <= 0 ? efe : efe <= 0 ? bcv : Math.min(efe, bcv));
  // El descuento nunca puede dejar la factura en negativo.
  const descuento = Math.min(Math.max(0, r2(Number(o.descuento) || 0)), base);
  return { base, descuento, impuestos, final: r2(base - descuento + impuestos) };
}

/**
 * Costo REAL que define la mejor oferta: el monto final que se va a pagar, con el
 * descuento por pago en efectivo, el descuento negociado y los impuestos ya aplicados.
 */
export function costoEfectivo(o: OfertaCotizada): number {
  return montoFinalOferta(o).final;
}

/**
 * Calcula el score de un grupo de ofertas (mismo orden_id).
 *
 * Precio se normaliza POR GRUPO (inverso del rango): la oferta más barata = 1.0,
 * la más cara = 0.0. Si todas tienen el mismo precio, todas = 1.0.
 *
 * Si una oferta no tiene historial (proveedor nuevo), recibe defaults neutros
 * desde `ProveedorStats` para no penalizarla arbitrariamente.
 */
export function scoreOfertas(
  ofertas: OfertaProveedor[],
  statsByProv: Map<string, ProveedorStats>,
  pesos: PesosScore = DEFAULT_PESOS_SCORE,
): ScoredOferta[] {
  if (!ofertas.length) return [];

  // El precio que decide es el COSTO REAL: efectivo (con descuento) cuando existe, si no BCV.
  const precios = ofertas.map((o) => costoEfectivo(o));
  const minP = Math.min(...precios);
  const maxP = Math.max(...precios);
  const rangeP = maxP - minP;

  // Normalizadores auxiliares para detectar "más puntual" / "mejor calidad" dentro del grupo
  let bestPuntualidad = -Infinity;
  let bestCalidad = -Infinity;

  const enriched = ofertas.map((o) => {
    const stats = statsByProv.get(o.proveedor_id) ?? {
      puntualidad_pct: 0.5,
      calidad_avg: 3,
      cumplimiento_pct: 1,
      total_evaluaciones: 0,
      total_ordenes: 0,
    };

    const precio = rangeP === 0 ? 1 : 1 - (costoEfectivo(o) - minP) / rangeP;
    const puntualidad = clamp01(stats.puntualidad_pct);
    const calidad = clamp01(stats.calidad_avg / 5);
    const cumplimiento = clamp01(stats.cumplimiento_pct);

    const total =
      pesos.precio * precio +
      pesos.puntualidad * puntualidad +
      pesos.calidad * calidad +
      pesos.cumplimiento * cumplimiento;

    if (stats.puntualidad_pct > bestPuntualidad) bestPuntualidad = stats.puntualidad_pct;
    if (stats.calidad_avg > bestCalidad) bestCalidad = stats.calidad_avg;

    return { oferta: o, stats, score: { total, precio, puntualidad, calidad, cumplimiento } };
  });

  const maxTotal = Math.max(...enriched.map((e) => e.score.total));

  return enriched.map((e) => ({
    ...e,
    recomendada: e.score.total === maxTotal,
    mejorPrecio: costoEfectivo(e.oferta) === minP,
    masPuntual: e.stats.puntualidad_pct === bestPuntualidad && e.stats.total_evaluaciones > 0,
    mejorCalidad: e.stats.calidad_avg === bestCalidad && e.stats.total_evaluaciones > 0,
  }));
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
