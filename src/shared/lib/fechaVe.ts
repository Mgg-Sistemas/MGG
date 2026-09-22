/* ============================================================
   MGG · Fechas en formato venezolano

   Acá se escribe y se lee **dd/mm/aaaa**. El navegador muestra el campo de
   fecha según el idioma con el que esté configurado, así que en una máquina
   en inglés el mismo campo pide mm/dd/aaaa — y ahí «03/04» deja de ser el
   3 de abril para pasar a ser el 4 de marzo, sin que nadie lo note.

   Por eso el campo se escribe a mano en dd/mm/aaaa siempre, y el calendario
   queda como ayuda al lado.

   La base guarda **aaaa-mm-dd** (ISO). Estas funciones traducen entre las dos.
   ============================================================ */

/** aaaa-mm-dd → dd/mm/aaaa. Vacío si no hay fecha. */
export function isoAVe(iso: unknown): string {
  const s = String(iso ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const [a, m, d] = s.split('-');
  return `${d}/${m}/${a}`;
}

/** ¿Existe ese día? El 31 de febrero se escribe igual de fácil que el 28. */
export function diaValido(d: number, m: number, a: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const bisiesto = (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0;
  const dias = [31, bisiesto ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d <= dias[m - 1];
}

/**
 * dd/mm/aaaa → aaaa-mm-dd. Devuelve `null` si está incompleta o no existe.
 * Acepta separadores `/`, `-` y `.`, y el día y el mes con uno o dos dígitos:
 * quien escribe rápido pone «3/4/1990».
 */
export function veAIso(ve: unknown): string | null {
  const s = String(ve ?? '').trim();
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mes = Number(m[2]);
  const a = Number(m[3]);
  if (!diaValido(d, mes, a)) return null;
  return `${a}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** ¿Es una fecha venezolana completa y real? */
export function fechaVeValida(ve: unknown): boolean {
  return veAIso(ve) !== null;
}

/**
 * Va poniendo las barras mientras se escribe, y no deja meter letras.
 * No valida: mientras se tipea, «3/» todavía no es una fecha y tiene que
 * poder existir.
 */
export function mascaraFechaVe(v: string): string {
  const n = String(v ?? '').replace(/\D/g, '').slice(0, 8);
  if (n.length <= 2) return n;
  if (n.length <= 4) return `${n.slice(0, 2)}/${n.slice(2)}`;
  return `${n.slice(0, 2)}/${n.slice(2, 4)}/${n.slice(4)}`;
}

/**
 * Qué está mal con la fecha, en palabras. `null` si está bien o si está
 * vacía (vacía no es un error: el campo puede ser opcional).
 */
export function errorFechaVe(ve: unknown, opciones: { futuro?: boolean; minAnio?: number } = {}): string | null {
  const s = String(ve ?? '').trim();
  if (!s) return null;
  const iso = veAIso(s);
  if (!iso) {
    return /^\d{1,2}[/\-.]\d{1,2}[/\-.]\d{4}$/.test(s)
      ? 'Ese día no existe. Revisá el día y el mes.'
      : 'La fecha va en formato dd/mm/aaaa.';
  }
  const hoy = new Date().toISOString().slice(0, 10);
  if (opciones.futuro === false && iso > hoy) return 'La fecha no puede ser futura.';
  const anio = Number(iso.slice(0, 4));
  if (opciones.minAnio && anio < opciones.minAnio) return `El año parece equivocado (${anio}).`;
  return null;
}
