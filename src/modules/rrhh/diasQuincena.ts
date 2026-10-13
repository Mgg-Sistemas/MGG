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

   13-10-2026 · Quien INGRESÓ dentro de la quincena cobra desde su ingreso:
   entró el 10 de la primera quincena → 6 días (del 10 al 15), todos
   trabajados y sin descanso, no 11 + 4. Antes se le cargaba la quincena
   entera y RRHH tenía que corregirlo a mano (o no lo veía).
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

/** Primer y último día (aaaa-mm-dd) de la quincena en que cae la fecha. */
export function rangoQuincena(iso: string): { desde: string; hasta: string } {
  const anio = Number(String(iso ?? '').slice(0, 4)) || new Date().getFullYear();
  const mes = Number(String(iso ?? '').slice(5, 7)) || 1;
  const mm = String(mes).padStart(2, '0');
  return quincenaDeFecha(iso) === 1
    ? { desde: `${anio}-${mm}-01`, hasta: `${anio}-${mm}-15` }
    : { desde: `${anio}-${mm}-16`, hasta: `${anio}-${mm}-${String(diasDelMes(anio, mes)).padStart(2, '0')}` };
}

/** Días del calendario entre dos fechas aaaa-mm-dd, contando las dos. */
function diasEntre(desde: string, hasta: string): number {
  const a = Date.UTC(Number(desde.slice(0, 4)), Number(desde.slice(5, 7)) - 1, Number(desde.slice(8, 10)));
  const b = Date.UTC(Number(hasta.slice(0, 4)), Number(hasta.slice(5, 7)) - 1, Number(hasta.slice(8, 10)));
  return Math.max(0, Math.round((b - a) / 86400000) + 1);
}

/** Reparte un total de días: hasta 11 trabajados y el resto descanso (menos de 11 → todos trabajados). */
export function repartirDias(total: number): DiasQuincena {
  const t = Math.max(0, Math.trunc(Number(total) || 0));
  const trabajados = Math.min(DIAS_TRABAJADOS, t);
  return { trabajados, descanso: t - trabajados, total: t };
}

/**
 * Los días que se le pagan en la quincena de `iso` a quien ingresó en
 * `fechaIngreso`: la quincena completa si entró antes de que empezara (o no
 * tiene fecha), desde su ingreso hasta el último día si entró dentro, y nada
 * si todavía no ha ingresado. `tope` acota el total (los «días base» que se
 * escriban a mano); nunca se cobra más de lo que da la fecha de ingreso.
 */
export function diasDesdeIngreso(iso: string, fechaIngreso: string | null | undefined, tope?: number): DiasQuincena {
  const { desde, hasta } = rangoQuincena(iso);
  const ing = String(fechaIngreso ?? '').slice(0, 10);
  const total = diasDeFecha(iso).total;
  const posibles = !/^\d{4}-\d{2}-\d{2}$/.test(ing) || ing <= desde ? total : ing > hasta ? 0 : diasEntre(ing, hasta);
  return repartirDias(tope == null ? posibles : Math.min(posibles, Math.max(0, tope)));
}

/** ¿La persona ingresó dentro de esa quincena (y por eso no cobra los días de antes)? */
export function ingresaEnLaQuincena(iso: string, fechaIngreso: string | null | undefined): boolean {
  const { desde, hasta } = rangoQuincena(iso);
  const ing = String(fechaIngreso ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(ing) && ing > desde && ing <= hasta;
}
