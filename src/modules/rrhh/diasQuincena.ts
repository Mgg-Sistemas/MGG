/* ============================================================
   MGG · Los días de una quincena

   En MGG la quincena no se cuenta a ojo: son **11 días trabajados fijos** más
   los de descanso que traiga el período. Los dos se pagan al mismo sueldo
   diario —no cambia lo que cobra nadie—, pero el recibo los exige en renglones
   distintos, y con esto dejan de cargarse a mano cada vez.

   · 1ª quincena: días 1 al 15 → siempre 15 días → 11 + 4.
   · 2ª quincena: del 16 al último del mes, así que depende del mes:
       31 días → 16 → 11 + 5      (el día de más es descanso)
       30 días → 15 → 11 + 4
       29 días → 14 → 11 + 3
       28 días → 13 → 11 + 2

   Los trabajados NO se mueven: lo que absorbe el largo del mes es el descanso.
   ============================================================ */

/** Días trabajados de cualquier quincena. No cambia con el mes. */
export const DIAS_TRABAJADOS = 11;
/** Días de descanso de una quincena de 15 días (el caso normal). */
export const DIAS_DESCANSO = 4;
/** La quincena tipo: 11 + 4. */
export const DIAS_QUINCENA = DIAS_TRABAJADOS + DIAS_DESCANSO;

export type Quincena = 1 | 2;

export interface DiasQuincena {
  trabajados: number;
  descanso: number;
  /** trabajados + descanso: los días que se pagan. */
  total: number;
}

/** Cuántos días trae ese mes (mes de 1 a 12). */
export function diasDelMes(anio: number, mes: number): number {
  return new Date(anio, mes, 0).getDate();
}

/** A qué quincena cae una fecha: hasta el 15 la primera, del 16 en adelante la segunda. */
export function quincenaDeFecha(iso: string): Quincena {
  const dia = Number(String(iso ?? '').slice(8, 10)) || 1;
  return dia <= 15 ? 1 : 2;
}

/**
 * Los días que se pagan en esa quincena.
 *
 * Los trabajados son 11 siempre; el descanso es lo que sobra. Por eso un mes
 * de 31 paga 16 días en la segunda quincena y febrero paga 13: se paga por
 * día del calendario, no por una quincena teórica de 15.
 */
export function diasDeQuincena(anio: number, mes: number, q: Quincena): DiasQuincena {
  const total = q === 1 ? 15 : Math.max(0, diasDelMes(anio, mes) - 15);
  const trabajados = Math.min(DIAS_TRABAJADOS, total);
  return { trabajados, descanso: total - trabajados, total };
}

/** Los días de la quincena en que cae esa fecha (aaaa-mm-dd). */
export function diasDeFecha(iso: string): DiasQuincena {
  const anio = Number(String(iso ?? '').slice(0, 4)) || new Date().getFullYear();
  const mes = Number(String(iso ?? '').slice(5, 7)) || 1;
  return diasDeQuincena(anio, mes, quincenaDeFecha(iso));
}

/** Cómo se llama esa quincena, para el nombre de la nómina. */
export function etiquetaQuincena(iso: string): string {
  return quincenaDeFecha(iso) === 1 ? 'Primera quincena' : 'Segunda quincena';
}
