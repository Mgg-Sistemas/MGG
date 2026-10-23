/* ============================================================
   Golden Touch · Libro fiscal · Piezas comunes de los dos PDF

   El margen de 2 cm de los documentos de GT, el texto apto para las fuentes
   estándar de jsPDF (`pdfSafe`) y el formato de montos y fechas. Los datos de
   la empresa salen de Parámetros y, si faltan, de `empresa.ts`: nunca se
   escriben a mano.
   ============================================================ */
import { pdfSafe } from '@/shared/lib/pdfSafe';

/** 2 cm en puntos, como el resto de los documentos de GT. */
export const MARGEN_PDF = 56.7;
export const MARGENES_TABLA_PDF = { top: MARGEN_PDF, right: MARGEN_PDF, bottom: MARGEN_PDF, left: MARGEN_PDF };
export const limiteInferiorPdf = (altoPagina: number) => altoPagina - MARGEN_PDF;
export const anchoUtilPdf = (anchoPagina: number) => anchoPagina - 2 * MARGEN_PDF;

/** Texto que las fuentes estándar de jsPDF saben dibujar. */
export const textoPdf = (v: unknown) => pdfSafe(v == null ? '' : String(v));
export const filaPdf = (fila: unknown[]) => fila.map((c) => textoPdf(c));

export function montoPdf(n: number | null | undefined, moneda: string): string {
  const v = Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return moneda === 'Bs' ? `Bs ${v}` : `$ ${v}`;
}

export function fechaPdf(iso: string | null | undefined): string {
  const s = String(iso ?? '').slice(0, 10);
  const [y, m, d] = s.split('-');
  return y && m && d ? `${d}/${m}/${y}` : '—';
}
