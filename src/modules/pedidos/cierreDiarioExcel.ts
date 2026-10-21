/* ============================================================
   MGG · Compras · Cierre diario (Excel) · 21-10-2026
   Una hoja con lo mismo que la pantalla: título, período, fecha y hora de impresión y
   los cuatro títulos con su cantidad (como NÚMERO, para poder sumarla). Estilos del
   sistema. Se MUESTRA en vista previa: nada se descarga solo.
   ============================================================ */
import { previewWorkbook } from '@/shared/lib/reportPreview';
import { ENCABEZADO, SUBTITULO, TITULO, rgb, type Celda, type XlsxLike } from './reporteComprasExcel';
import { COLOR_TOTAL, COLOR_TOTAL_TEXTO } from './comprasReporte';
import { fechaReporteTexto } from './comprasReporteMensaje';
import type { ResumenCierre } from './cierreDiario';

async function construirLibro(r: ResumenCierre, impresoIso: string): Promise<{ XLSX: XlsxLike; wb: unknown; nombre: string }> {
  const XLSX = (await import('xlsx-js-style')) as unknown as XlsxLike;
  const aoa: unknown[][] = [
    ['CIERRE DIARIO · COMPRAS · MGG'],
    [`Período: ${r.rango.etiqueta}`],
    [`Impreso: ${fechaReporteTexto(impresoIso)}`],
    [],
    ['CONCEPTO', 'CANTIDAD'],
    ...r.items.map((i) => [`${i.emoji} ${i.titulo}`, i.cantidad]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const w = ws as Record<string, unknown>;
  const cell = (row: number, col: number) => (ws as Record<string, Celda>)[XLSX.utils.encode_cell({ r: row, c: col })];
  w['!cols'] = [{ wch: 52 }, { wch: 14 }];
  w['!merges'] = [0, 1, 2].map((row) => ({ s: { r: row, c: 0 }, e: { r: row, c: 1 } }));
  const t = cell(0, 0); if (t) t.s = TITULO;
  for (const row of [1, 2]) { const c = cell(row, 0); if (c) c.s = SUBTITULO; }
  for (const col of [0, 1]) { const c = cell(4, col); if (c) c.s = ENCABEZADO; }
  const filaCuerpo = { font: { name: 'Arial', sz: 11 }, fill: { patternType: 'solid', fgColor: { rgb: rgb(COLOR_TOTAL) } } };
  for (let row = 5; row < aoa.length; row++) {
    const c0 = cell(row, 0); if (c0) c0.s = { ...filaCuerpo, font: { name: 'Arial', sz: 11, color: { rgb: rgb(COLOR_TOTAL_TEXTO) } } };
    const c1 = cell(row, 1);
    if (c1) { c1.z = '0'; c1.s = { ...filaCuerpo, font: { name: 'Arial', sz: 12, bold: true, color: { rgb: rgb(COLOR_TOTAL_TEXTO) } }, alignment: { horizontal: 'right' } }; }
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Cierre diario');
  return { XLSX, wb, nombre: 'cierre-diario-compras.xlsx' };
}

/** 📊 Muestra el Excel en vista previa (con su botón de descarga). */
export async function exportarCierreDiarioExcel(r: ResumenCierre, impresoIso: string = new Date().toISOString()): Promise<void> {
  const { XLSX, wb, nombre } = await construirLibro(r, impresoIso);
  previewWorkbook(XLSX, wb, nombre);
}
