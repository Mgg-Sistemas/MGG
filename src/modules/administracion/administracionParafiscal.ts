/* ============================================================================
   Golden Touch · Administración · parafiscales (cálculo puro)
   FAOV/BANAVIH (Gaceta Extra 6.805, art. 98): la multa = FACTOR × el tipo de
   cambio de referencia de MAYOR valor del BCV, según el tamaño de la nómina:
     · ≤ 50 trabajadores  → 165
     · 51–100 trabajadores → 330
     · > 100 trabajadores  → 1.000
   El total sale en Bs (factor × tasa). Sin React, determinista.
   ============================================================================ */

export type NivelNomina = 'hasta50' | 'hasta100' | 'mas100';

export interface TierFaov {
  nivel: NivelNomina;
  factor: number;
  label: string;
}

export const FAOV_TIERS: TierFaov[] = [
  { nivel: 'hasta50', factor: 165, label: 'Nómina ≤ 50 trabajadores' },
  { nivel: 'hasta100', factor: 330, label: 'Nómina 51–100 trabajadores' },
  { nivel: 'mas100', factor: 1000, label: 'Nómina > 100 trabajadores' },
];

/**
 * Tramo (y factor) segun el numero de trabajadores de la nomina.
 *
 * Los factores se pueden pasar: son de ley, pero la ley cambia. Antes estaban
 * escritos aqui y hacia falta tocar codigo y desplegar para ajustarlos
 * (12/11/2026). Ahora se guardan en Configuracion y FAOV_TIERS es solo el
 * valor de partida.
 */
export function tierPorTrabajadores(n: number, tiers: TierFaov[] = FAOV_TIERS): TierFaov {
  const t = Math.max(0, Math.trunc(Number(n) || 0));
  const usar = factoresValidos(tiers) ? tiers : FAOV_TIERS;
  if (t <= 50) return usar[0];
  if (t <= 100) return usar[1];
  return usar[2];
}

/**
 * Si unos factores sirven para calcular: los tres tramos, en orden, con factor
 * mayor que cero. Sin esto se podria guardar media tabla y las multas saldrian
 * mal sin que nadie lo notara.
 */
export function factoresValidos(tiers: unknown): tiers is TierFaov[] {
  if (!Array.isArray(tiers) || tiers.length !== 3) return false;
  const orden: NivelNomina[] = ['hasta50', 'hasta100', 'mas100'];
  return tiers.every((t, i) => {
    const x = t as Partial<TierFaov> | null;
    return !!x && x.nivel === orden[i] && Number.isFinite(Number(x.factor)) && Number(x.factor) > 0;
  });
}

/** Total a pagar del FAOV = factor × tasa de referencia (en Bs), a 2 decimales. */
export function calcularFaov(factor: number, tasaReferencia: number): number {
  const f = Number(factor) || 0;
  const t = Number(tasaReferencia) || 0;
  return Math.round(f * t * 100) / 100;
}
