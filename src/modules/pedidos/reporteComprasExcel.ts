/* ============================================================
   MGG · Compras · Reporte por renglones (Excel)
   El mismo reporte del PDF, en un libro con dos hojas:
     · «Por renglón»: las compras agrupadas por su tipo, cada una con
       código, tipo, motivo, moneda y monto (en crédito, abonado y saldo).
     · «Resumen»: cuántos renglones y cuánto suma cada grupo, en $ y en Bs.
   El MONTO va como NÚMERO (no texto) para que se pueda sumar en Excel; la
   moneda va en su columna, así no se mezclan pesos con bolívares.
   Estilos del sistema: naranja de la marca, encabezados y totales.
   Se MUESTRA en vista previa (nada se descarga solo).
   ============================================================ */
import { previewWorkbook } from '@/shared/lib/reportPreview';
import { agruparReporte, fmtMonto, totalesPorMoneda, COLOR_TOTAL, COLOR_TOTAL_TEXTO, type FilaReporteCompras } from './comprasReporte';

/** Lo mínimo del módulo xlsx-js-style que hace falta (se acepta sin tipar, como en el resto). */
export interface XlsxLike {
  utils: {
    aoa_to_sheet: (d: unknown[][]) => Record<string, unknown>;
    encode_cell: (c: { r: number; c: number }) => string;
    book_new: () => unknown;
    book_append_sheet: (wb: unknown, ws: unknown, name: string) => void;
  };
}
export type Celda = { v?: unknown; t?: string; z?: string; s?: unknown } | undefined;

const NARANJA = COLOR_TOTAL;
const GRIS_ENCABEZADO = 'F2F2F2';
/** #rrggbb (pantalla) → RRGGBB (Excel). */
export const rgb = (hex: string): string => hex.replace('#', '').toUpperCase();

export const TITULO = { font: { name: 'Arial', sz: 14, bold: true, color: { rgb: rgb(COLOR_TOTAL_TEXTO) } }, fill: { patternType: 'solid', fgColor: { rgb: rgb(NARANJA) } }, alignment: { horizontal: 'left', vertical: 'center' } };
export const SUBTITULO = { font: { name: 'Arial', sz: 9, italic: true, color: { rgb: '666666' } } };
export const ENCABEZADO = { font: { name: 'Arial', sz: 10, bold: true, color: { rgb: '333333' } }, fill: { patternType: 'solid', fgColor: { rgb: GRIS_ENCABEZADO } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true } };
export const TOTAL = { font: { name: 'Arial', sz: 11, bold: true, color: { rgb: rgb(COLOR_TOTAL_TEXTO) } }, fill: { patternType: 'solid', fgColor: { rgb: rgb(NARANJA) } }, alignment: { horizontal: 'right', vertical: 'center' } };
export const MONEDA_FMT = '#,##0.00';

/** Una fila de datos del reporte, en las columnas del Excel. */
function filaExcel(f: FilaReporteCompras, i: number, esCredito: boolean): unknown[] {
  return [i + 1, f.codigo, f.tipo, f.motivo, f.moneda === 'Bs' ? 'Bs' : '$', f.monto, esCredito ? f.abonado : '', esCredito ? f.saldo : ''];
}

/** Arma el libro completo (las dos hojas). */
async function construirLibro(filas: FilaReporteCompras[]): Promise<{ XLSX: XlsxLike; wb: unknown; nombre: string }> {
  const [XLSXmod, { dateTime }] = await Promise.all([import('xlsx-js-style'), import('@/shared/lib/format')]);
  const XLSX = XLSXmod as unknown as XlsxLike;
  const grupos = agruparReporte(filas).filter((g) => g.filas.length > 0);
  const { usd, bs } = totalesPorMoneda(filas);

  // ── Hoja 1 · Por renglón ──
  const aoa: unknown[][] = [
    ['REPORTE DE COMPRAS POR RENGLÓN · MGG'],
    [`${filas.length} renglón(es) pendiente(s) · ${dateTime(new Date().toISOString())}`],
    [],
    ['#', 'CÓDIGO', 'TIPO', 'MOTIVO', 'MONEDA', 'MONTO', 'ABONADO', 'SALDO'],
  ];
  /** Marcas de estilo por fila: título, subtítulo, encabezado, cabecera de grupo o total. */
  const marcas: { fila: number; tipo: 'titulo' | 'subtitulo' | 'encabezado' | 'grupo' | 'total'; color?: string; colorTexto?: string }[] = [
    { fila: 0, tipo: 'titulo' }, { fila: 1, tipo: 'subtitulo' }, { fila: 3, tipo: 'encabezado' },
  ];
  for (const g of grupos) {
    marcas.push({ fila: aoa.length, tipo: 'grupo', color: g.color, colorTexto: g.colorTexto });
    aoa.push([`${g.emoji} ${g.titulo} · ${g.filas.length}`]);
    g.filas.forEach((f, i) => aoa.push(filaExcel(f, i, g.key === 'cuenta_abierta')));
  }
  if (grupos.length) {
    marcas.push({ fila: aoa.length, tipo: 'total' });
    aoa.push(['', '', '', 'TOTAL GENERAL', '', fmtMonto(usd, 'USD') + (bs > 0 ? `  ·  ${fmtMonto(bs, 'Bs')}` : ''), '', '']);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const cellAt = (r: number, c: number) => (ws as Record<string, Celda>)[XLSX.utils.encode_cell({ r, c })];
  (ws as Record<string, unknown>)['!cols'] = [
    { wch: 5 }, { wch: 18 }, { wch: 18 }, { wch: 66 }, { wch: 9 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
  ];
  (ws as Record<string, unknown>)['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 7 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 7 } },
  ];
  for (const m of marcas) {
    if (m.tipo === 'grupo') {
      (ws as Record<string, unknown>)['!merges'] = [...((ws as Record<string, unknown>)['!merges'] as unknown[]), { s: { r: m.fila, c: 0 }, e: { r: m.fila, c: 7 } }];
      const c0 = cellAt(m.fila, 0);
      if (c0) c0.s = { font: { name: 'Arial', sz: 11, bold: true, color: { rgb: rgb(m.colorTexto ?? COLOR_TOTAL_TEXTO) } }, fill: { patternType: 'solid', fgColor: { rgb: rgb(m.color ?? NARANJA) } }, alignment: { horizontal: 'left', vertical: 'center' } };
      continue;
    }
    const estilo = m.tipo === 'titulo' ? TITULO : m.tipo === 'subtitulo' ? SUBTITULO : m.tipo === 'encabezado' ? ENCABEZADO : TOTAL;
    for (let c = 0; c < 8; c++) { const cell = cellAt(m.fila, c); if (cell) cell.s = estilo; }
  }
  // Números con formato de dos decimales y alineados a la derecha (MONTO / ABONADO / SALDO).
  for (let r = 4; r < aoa.length; r++) {
    for (const c of [5, 6, 7]) {
      const cell = cellAt(r, c);
      if (cell && typeof cell.v === 'number') { cell.z = MONEDA_FMT; cell.s = { ...(cell.s as object ?? {}), alignment: { horizontal: 'right' } }; }
    }
    const c0 = cellAt(r, 0); if (c0 && typeof c0.v === 'number') c0.s = { ...(c0.s as object ?? {}), alignment: { horizontal: 'center' } };
  }

  // ── Hoja 2 · Resumen ──
  const resumen: unknown[][] = [
    ['RESUMEN POR RENGLÓN · MGG'],
    [],
    ['RENGLÓN', 'RENGLONES', 'TOTAL $', 'TOTAL Bs'],
    ...grupos.map((g) => [`${g.emoji} ${g.titulo}`, g.filas.length, g.totalUsd, g.totalBs]),
    ['💵 TOTAL GENERAL', filas.length, usd, bs],
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(resumen);
  const cell2 = (r: number, c: number) => (ws2 as Record<string, Celda>)[XLSX.utils.encode_cell({ r, c })];
  (ws2 as Record<string, unknown>)['!cols'] = [{ wch: 34 }, { wch: 12 }, { wch: 16 }, { wch: 16 }];
  (ws2 as Record<string, unknown>)['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];
  const t2 = cell2(0, 0); if (t2) t2.s = TITULO;
  for (let c = 0; c < 4; c++) { const h = cell2(2, c); if (h) h.s = ENCABEZADO; }
  for (let r = 3; r < resumen.length; r++) {
    for (const c of [2, 3]) {
      const cell = cell2(r, c);
      if (cell && typeof cell.v === 'number') { cell.z = MONEDA_FMT; cell.s = { alignment: { horizontal: 'right' } }; }
    }
    if (r === resumen.length - 1) for (let c = 0; c < 4; c++) { const cell = cell2(r, c); if (cell) cell.s = TOTAL; }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Por renglón');
  XLSX.utils.book_append_sheet(wb, ws2, 'Resumen');
  return { XLSX, wb, nombre: 'reporte-compras-por-renglon.xlsx' };
}

/** 📊 Muestra el Excel en vista previa (con su botón de descarga). */
export async function exportarReporteComprasExcel(filas: FilaReporteCompras[]): Promise<void> {
  const { XLSX, wb, nombre } = await construirLibro(filas);
  previewWorkbook(XLSX, wb, nombre);
}
