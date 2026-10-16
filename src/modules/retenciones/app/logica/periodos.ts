/* ============================================================
   MGG · Retenciones · Los períodos de cada impuesto

   La regla de los tramos vive en la base (retencion_tramos_del_mes y
   retencion_cortes_validos): es la única fuente. Esta copia sirve para la
   vista previa de Parámetros y para las pruebas, y tiene que dar lo mismo.

   · Mensual o por pago: un tramo, el 0, todo el mes.
   · Quincenal: 1 (del 1 al 15) y 2 (del 16 al fin de mes).
   · Semanal: de lunes a domingo, cortada al principio y al fin del mes.
   · Personalizada: según los días de corte (el inicio de cada tramo).

   Un tramo nunca cruza de un mes a otro.
   ============================================================ */

export type Periodicidad = 'mensual' | 'quincenal' | 'semanal' | 'personalizada' | 'por_pago';

export interface Tramo {
  tramo: number;
  /** Fechas ISO (aaaa-mm-dd). */
  desde: string;
  hasta: string;
}

export interface PeriodicidadVigente {
  valor: Periodicidad;
  cortes: number[] | null;
  /** Desde cuándo rige; null = desde siempre. */
  desde: string | null;
}

const dos = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${dos(m)}-${dos(d)}`;
const ultimoDia = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** 0 = lunes … 6 = domingo. */
const diaSemana = (y: number, m: number, d: number) => (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;

/** Los días de corte que acepta la base: de 2 a 10, el primero 1, crecientes y hasta el 28. */
export function cortesValidos(cortes: readonly number[]): boolean {
  if (cortes.length < 2 || cortes.length > 10 || cortes[0] !== 1) return false;
  for (let i = 1; i < cortes.length; i++) {
    const c = cortes[i];
    if (!Number.isInteger(c) || c <= cortes[i - 1] || c > 28) return false;
  }
  return true;
}

/** Los cortes escritos («1, 11, 21»), sin repetir y en orden. No añade nada: lo valida cortesValidos. */
export function leerCortes(texto: string): number[] {
  const nums = String(texto ?? '').split(/[^\d]+/).filter(Boolean).map(Number);
  return [...new Set(nums)].sort((a, b) => a - b);
}

export function tramosDelMes(per: Periodicidad, periodo: string, cortes?: readonly number[] | null): Tramo[] {
  if (!/^\d{4}(0[1-9]|1[0-2])$/.test(periodo ?? '')) {
    throw new Error(`RET_TRAMO_PERIODO: El período va como AAAAMM (recibido: ${periodo || '—'}).`);
  }
  const y = Number(periodo.slice(0, 4)), m = Number(periodo.slice(4, 6)), fin = ultimoDia(y, m);
  if (per === 'quincenal') return [{ tramo: 1, desde: iso(y, m, 1), hasta: iso(y, m, 15) }, { tramo: 2, desde: iso(y, m, 16), hasta: iso(y, m, fin) }];
  if (per === 'semanal') {
    const out: Tramo[] = [];
    for (let d = 1; d <= fin;) {
      const h = Math.min(fin, d + 6 - diaSemana(y, m, d));
      out.push({ tramo: out.length + 1, desde: iso(y, m, d), hasta: iso(y, m, h) });
      d = h + 1;
    }
    return out;
  }
  if (per === 'personalizada') {
    if (!cortes || !cortesValidos(cortes)) {
      throw new Error('RET_TRAMOS_SIN_CORTES: La periodicidad es personalizada pero no tiene cortes válidos (días de inicio de cada tramo).');
    }
    return cortes.map((c, i) => ({ tramo: i + 1, desde: iso(y, m, c), hasta: iso(y, m, i < cortes.length - 1 ? cortes[i + 1] - 1 : fin) }));
  }
  return [{ tramo: 0, desde: iso(y, m, 1), hasta: iso(y, m, fin) }];
}

/** El tramo que contiene la fecha (ISO). */
export function tramoDe(per: Periodicidad, fecha: string, cortes?: readonly number[] | null): number {
  const periodo = fecha.slice(0, 4) + fecha.slice(5, 7);
  return tramosDelMes(per, periodo, cortes).find((t) => t.desde <= fecha && fecha <= t.hasta)?.tramo ?? 0;
}

/** La periodicidad que rige en la fecha: la última que ya empezó; si ninguna, la primera. */
export function periodicidadEn(historial: readonly PeriodicidadVigente[], fecha: string): PeriodicidadVigente {
  const orden = [...historial].sort((a, b) => (a.desde ?? '').localeCompare(b.desde ?? ''));
  return orden.filter((p) => !p.desde || p.desde <= fecha).at(-1) ?? orden[0];
}
