/* ============================================================
   MGG · Combustible · la cadena del horómetro

   Dos reglas que el surtidor tiene que ver cumplidas en la pantalla:

   1. HRS = HF − HI. Las horas trabajadas no se teclean: salen de la
      resta. Si alguien las escribiera aparte, el número del vale y el
      del horómetro terminarían discrepando.
   2. El HF de un surtido es el HI del siguiente surtido DEL MISMO
      EQUIPO. Por eso el HI se precarga y se bloquea: la cadena no se
      corta ni se pisa a mano.

   De ahí sale la validación: un HF menor que el HI no es solo un número
   raro, HACE RETROCEDER la cadena, porque ese HF es el HI que va a
   precargar el próximo surtido. Se rechaza antes de guardar.

   Acá viven las piezas puras: se testean sin base ni pantalla.
   ============================================================ */

/** Lee un campo numérico de formulario: vacío o basura es «no lo cargaron». */
export function leerMedidor(v: string | number | null | undefined): number | null {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * Horas trabajadas del surtido: HF − HI, con dos decimales.
 *
 * Devuelve null cuando todavía no se puede afirmar nada: falta uno de los dos
 * medidores. El cero sí se devuelve (HF = HI es «no trabajó», un dato válido);
 * el negativo también, para que la pantalla pueda mostrar el problema en vez de
 * esconderlo detrás de un guión.
 */
export function horasTrabajadas(
  hi: string | number | null | undefined,
  hf: string | number | null | undefined,
): number | null {
  const a = leerMedidor(hi);
  const b = leerMedidor(hf);
  if (a == null || b == null) return null;
  return Math.round((b - a) * 100) / 100;
}

/**
 * Por qué no se puede guardar este par de horómetros, o null si está bien.
 *
 * Solo se rechaza el retroceso: el HF de hoy es el HI de mañana, así que un HF
 * menor que el HI dejaría la cadena del equipo corriendo para atrás.
 */
export function errorHorometro(
  hi: string | number | null | undefined,
  hf: string | number | null | undefined,
): string | null {
  const horas = horasTrabajadas(hi, hf);
  if (horas == null || horas >= 0) return null;
  return 'El horómetro final no puede ser menor que el inicial: ese número queda '
    + 'como horómetro inicial del próximo surtido del equipo.';
}

/** «1500 → 1512,5 · 12,5 h» para el detalle de un movimiento ya guardado. */
export function textoHorometro(
  hi: number | null | undefined,
  hf: number | null | undefined,
  formatear: (n: number) => string = (n) => String(n),
): string | null {
  if (hi == null && hf == null) return null;
  const tramo = `${hi != null ? formatear(hi) : '—'} → ${hf != null ? formatear(hf) : '—'}`;
  const horas = horasTrabajadas(hi, hf);
  return horas == null ? tramo : `${tramo} · ${formatear(horas)} h`;
}
