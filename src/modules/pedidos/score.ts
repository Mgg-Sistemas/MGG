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

/**
 * Costo REAL que define la mejor oferta: si el proveedor da descuento por pago en
 * divisa efectivo (precio_efectivo válido y menor al BCV), ese es el costo que cuenta;
 * si no, el total a BCV. Así la oferta con mejor precio en efectivo puede ganar.
 */
export function costoEfectivo(o: Pick<OfertaProveedor, 'precio_total' | 'precio_efectivo'>): number {
  const bcv = Number(o.precio_total) || 0;
  const efe = Number(o.precio_efectivo) || 0;
  if (bcv <= 0) return efe;             // oferta SOLO en USD efectivo (sin precio Bs)
  if (efe <= 0) return bcv;             // oferta SOLO en Bs a BCV
  return efe < bcv ? efe : bcv;         // ambos: manda el efectivo si trae descuento
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
