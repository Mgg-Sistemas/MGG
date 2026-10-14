/* ============================================================
   MGG · Retenciones · Impresión · Números y fechas del ejemplar

   Se escriben a mano (no con toLocaleString) para que la hoja salga
   igual en cualquier equipo, sea cual sea el idioma del navegador.
   ============================================================ */
import { isoAVe } from '@/shared/lib/fechaVe';
import type { ClaveTotal, FilaComprobante, TotalesComprobante } from './tipos';

/** Céntimos de un monto, sin el error de coma flotante (1,005 → 101). */
function centimos(v: number): number {
  return Math.round(Number((Math.abs(v) * 100).toPrecision(15)));
}

/** Redondeo a 2 decimales. */
export function r2(valor: number | null | undefined): number {
  const v = Number(valor) || 0;
  return (v < 0 ? -1 : 1) * centimos(v) / 100;
}

/** Monto como en el ejemplar: miles con punto y dos decimales con coma («1.234.567,89»). */
export function n2(valor: number | string | null | undefined): string {
  const v = Number(valor) || 0;
  const c = centimos(v);
  const entero = String(Math.floor(c / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const signo = v < 0 && c > 0 ? '-' : '';
  return `${signo}${entero},${String(c % 100).padStart(2, '0')}`;
}

/** La base del comprobante de ISAE, como su ejemplar: miles con punto y también punto decimal («55.550.14»). */
export function n2PuntoDecimal(valor: number | string | null | undefined): string {
  return n2(valor).replace(/,(\d\d)$/, '.$1');
}

/** El % del comprobante de ISAE, como su ejemplar: sin decimales fijos y con punto («2.5»). */
export function pctIsae(valor: number | string | null | undefined): string {
  return String(Math.round((Number(valor) || 0) * 10000) / 10000);
}

/** El % de la relación del ISLR: sin decimales fijos y con coma («2», «2,5»). */
export function pctRelacion(valor: number | string | null | undefined): string {
  return String(Math.round((Number(valor) || 0) * 100) / 100).replace('.', ',');
}

/**
 * El N° del comprobante de ISAE en la hoja, como su ejemplar: AAAAMM de la
 * fecha de emisión, un espacio y 9 dígitos («202610 000000109»). La serie
 * interna es de 10 dígitos: se toman los 9 últimos.
 */
export function numeroIsae(numero: string | number | null | undefined, fechaIso: string): string {
  const aaaamm = String(fechaIso ?? '').slice(0, 7).replace('-', '');
  const digitos = String(numero ?? '').replace(/\D/g, '');
  return `${aaaamm} ${digitos.slice(-9).padStart(9, '0')}`;
}

/** aaaa-mm-dd → dd/mm/aaaa (vacío si no hay fecha). */
export function fechaVe(iso: string | null | undefined): string {
  return isoAVe(iso);
}

/** La hora como en la cabecera de las relaciones: «01:05 pm». */
export function horaAmPm(d: Date): string {
  const m = String(d.getMinutes()).padStart(2, '0');
  const h = d.getHours();
  return `${String(h % 12 || 12).padStart(2, '0')}:${m} ${h < 12 ? 'am' : 'pm'}`;
}

/** Fecha y hora locales de la generación: «14/10/2026 01:05 pm». */
export function fechaHoraRelacion(d: Date): string {
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `${fechaVe(iso)} ${horaAmPm(d)}`;
}

const CLAVES_TOTAL: ClaveTotal[] = ['total', 'sinDerecho', 'base', 'causado', 'retenido'];

/** Los totales del comprobante, sumados de sus filas (los que vengan dados mandan). */
export function totalesComprobante(filas: FilaComprobante[], dados?: Partial<TotalesComprobante>): TotalesComprobante {
  const suma = (c: ClaveTotal) => r2(filas.reduce((a, f) => a + (Number(f[c]) || 0), 0));
  return Object.fromEntries(CLAVES_TOTAL.map((c) => [c, dados?.[c] ?? suma(c)])) as TotalesComprobante;
}
