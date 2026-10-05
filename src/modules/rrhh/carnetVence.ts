/* ============================================================
   MGG · RRHH · Vencimiento del carnet (05-10-2026)

   El carnet vale hasta una fecha que se carga de dos formas:
   · por MES y AÑO: vale hasta el último día de ese mes (12/2026 → 31/12/2026);
   · por DURACIÓN: N días, semanas, meses o años contados desde hoy.
   Se guarda la fecha final en `personal.carnet_vence` y se imprime en el carnet.
   ============================================================ */

export type UnidadDuracion = 'dias' | 'semanas' | 'meses' | 'anios';

export const UNIDADES_DURACION: { key: UnidadDuracion; label: string }[] = [
  { key: 'dias', label: 'días' },
  { key: 'semanas', label: 'semanas' },
  { key: 'meses', label: 'meses' },
  { key: 'anios', label: 'años' },
];

/** Por ahora, todos los carnets valen hasta acá (orden de la administradora, 05-10-2026). */
export const CARNET_VENCE_POR_DEFECTO = '2026-12-31';

const dos = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${dos(m)}-${dos(d)}`;
const diasDelMes = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Último día del mes: (12, 2026) → «2026-12-31». */
export function finDeMes(mes: number, anio: number): string | null {
  if (!Number.isInteger(mes) || mes < 1 || mes > 12 || !Number.isInteger(anio) || anio < 2000 || anio > 2100) return null;
  return iso(anio, mes, diasDelMes(anio, mes));
}

/**
 * La fecha de vencimiento a partir de `desde` (aaaa-mm-dd) sumando una duración.
 * Meses y años no se pasan del fin de mes: 31/01 + 1 mes = 28/02 (o 29).
 */
export function venceTras(desde: string, cantidad: number, unidad: UnidadDuracion): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(desde);
  const n = Math.floor(Number(cantidad));
  if (!m || !(n > 0)) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (unidad === 'dias' || unidad === 'semanas') {
    const dt = new Date(Date.UTC(y, mo - 1, d + n * (unidad === 'semanas' ? 7 : 1)));
    return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  const meses = unidad === 'anios' ? n * 12 : n;
  const total = (mo - 1) + meses;
  const ny = y + Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return iso(ny, nm, Math.min(d, diasDelMes(ny, nm)));
}

/** «31/12/2026» para imprimir. */
export function textoVence(v: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** ¿Ya venció a la fecha `hoy`? (vale TODO el día del vencimiento). */
export function carnetVencido(v: string | null | undefined, hoy: string = new Date().toISOString().slice(0, 10)): boolean {
  return !!v && /^\d{4}-\d{2}-\d{2}/.test(v) && v.slice(0, 10) < hoy;
}
