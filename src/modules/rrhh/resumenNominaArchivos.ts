/* ============================================================
   MGG · RRHH · Excel y PDF del resumen de nómina (09-10-2026)
   Solo a pedido del usuario (botón), con vista previa antes de bajar:
   ningún reporte se descarga solo.
   ============================================================ */
import { previewPdfDoc, previewWorkbook } from '@/shared/lib/reportPreview';
import { MARGEN_PDF, MARGENES_TABLA_PDF, anchoUtilPdf, limiteInferiorPdf } from '@/shared/lib/pdfMargen';
import { textoPdf } from '@/shared/lib/textoPdf';
import { formatearValor, tablaResumen, type FilaResumen } from './resumenNomina';

const HEADER_STYLE = {
  font: { name: 'Arial', sz: 11, bold: true, color: { rgb: 'FFFFFF' } },
  fill: { patternType: 'solid', fgColor: { rgb: 'FF8A00' } },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  border: {
    top: { style: 'thin', color: { rgb: '000000' } }, bottom: { style: 'thin', color: { rgb: '000000' } },
    left: { style: 'thin', color: { rgb: '000000' } }, right: { style: 'thin', color: { rgb: '000000' } },
  },
};
const TITLE_STYLE = { font: { name: 'Arial', sz: 14, bold: true } };
const CELDA_STYLE = {
  font: { name: 'Arial', sz: 10 },
  alignment: { vertical: 'center', wrapText: true },
  border: HEADER_STYLE.border,
};
const TOTAL_STYLE = {
  font: { name: 'Arial', sz: 10, bold: true },
  fill: { patternType: 'solid', fgColor: { rgb: 'F0F0F0' } },
  alignment: { vertical: 'center' },
  border: HEADER_STYLE.border,
};
/** Formato de número de Excel para los montos (miles y dos decimales). */
const FORMATO_MONTO = '#,##0.00';

const hoyTxt = () => new Date().toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const nombreArchivo = (ext: string) => `resumen-nomina-${new Date().toISOString().slice(0, 10)}.${ext}`;

export interface MetaResumen {
  /** De qué es el resumen: la nómina o el rango (sale en el encabezado). */
  alcance: string;
}

function subtitulo(t: ReturnType<typeof tablaResumen>, filas: readonly FilaResumen[]): string {
  const nominas = new Set(filas.map((f) => f.fechaPeriodo + '|' + f.periodo)).size;
  const agrupado = filas.some((f) => f.nominas > 1);
  const renglones = agrupado ? `${filas.length} fila(s)` : `${filas.length} renglón(es)`;
  return `${t.personas} persona(s) · ${renglones}${!agrupado && nominas > 1 ? ` · ${nominas} nómina(s)` : ''} · ${hoyTxt()}`;
}

export async function descargarResumenNominaExcel(filas: FilaResumen[], keys: string[], meta: MetaResumen): Promise<void> {
  const XLSXmod = await import('xlsx-js-style');
  const XLSX = XLSXmod as unknown as {
    utils: {
      aoa_to_sheet: (d: unknown[][]) => Record<string, unknown>;
      encode_cell: (c: { r: number; c: number }) => string;
      book_new: () => unknown;
      book_append_sheet: (wb: unknown, ws: unknown, name: string) => void;
    };
  };
  const t = tablaResumen(filas, keys);
  const FILA_HEAD = 4;
  const aoa: unknown[][] = [
    ['RESUMEN DE NÓMINA · MGG'],
    [meta.alcance],
    [subtitulo(t, filas)],
    [],
    t.head,
    ...t.filas,
    t.totales,
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  (ws as Record<string, unknown>)['!cols'] = [{ wch: 6 }, ...t.columnas.map((c) => ({ wch: c.ancho }))];
  const ultimaCol = Math.max(0, t.head.length - 1);
  (ws as Record<string, unknown>)['!merges'] = [0, 1, 2].map((r) => ({ s: { r, c: 0 }, e: { r, c: ultimaCol } }));
  const cellAt = (r: number, c: number) => (ws as Record<string, { s?: unknown; z?: string }>)[XLSX.utils.encode_cell({ r, c })];
  const tituloCell = cellAt(0, 0); if (tituloCell) tituloCell.s = TITLE_STYLE;
  t.head.forEach((_, c) => { const cell = cellAt(FILA_HEAD, c); if (cell) cell.s = HEADER_STYLE; });
  // Cada celda con borde; los montos quedan como NÚMERO con formato (se pueden sumar en Excel).
  const estiloCelda = (r: number, c: number, base: typeof CELDA_STYLE | typeof TOTAL_STYLE) => {
    const cell = cellAt(r, c);
    if (!cell) return;
    const col = c === 0 ? null : t.columnas[c - 1];
    const alinear = c === 0 ? 'center' : col?.tipo === 'texto' ? 'left' : 'right';
    cell.s = { ...base, alignment: { ...base.alignment, horizontal: alinear } };
    if (col?.tipo === 'monto') cell.z = FORMATO_MONTO;
  };
  t.filas.forEach((f, i) => f.forEach((_, c) => estiloCelda(FILA_HEAD + 1 + i, c, CELDA_STYLE)));
  t.totales.forEach((_, c) => estiloCelda(FILA_HEAD + 1 + t.filas.length, c, TOTAL_STYLE));
  (ws as Record<string, unknown>)['!rows'] = [{ hpt: 24 }, { hpt: 18 }, { hpt: 16 }, { hpt: 8 }, { hpt: 30 }, ...t.filas.map(() => ({ hpt: 18 })), { hpt: 20 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Resumen');
  previewWorkbook(XLSX, wb, nombreArchivo('xlsx'));
}

/** Orientación de la hoja: la elige el usuario; «auto» la acuesta solo si hay muchas columnas. */
export type OrientacionPdf = 'auto' | 'vertical' | 'horizontal';

export async function descargarResumenNominaPdf(filas: FilaResumen[], keys: string[], meta: MetaResumen, orientacion: OrientacionPdf = 'auto'): Promise<void> {
  const [{ jsPDF }, { default: autoTable }, { loadLogoDataUrl }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('@/shared/lib/pdfLogo'),
  ]);
  const t = tablaResumen(filas, keys);
  const ANCHO_N = 6;
  const anchoTotal = ANCHO_N + t.columnas.reduce((a, c) => a + c.ancho, 0);
  // Con muchas columnas, la hoja va acostada para que todo entre. Si se va a
  // imprimir parada, el usuario lo elige y la letra se achica en vez de girar.
  const horizontal = orientacion === 'horizontal' || (orientacion === 'auto' && anchoTotal > 95);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: horizontal ? 'landscape' : 'portrait' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const util = anchoUtilPdf(W);
  const ptPorCaracter = util / anchoTotal;
  const letra = Math.max(6, Math.min(9.5, Math.round(ptPorCaracter * 1.7 * 2) / 2));
  const relleno = letra >= 9 ? 5 : letra >= 7.5 ? 4 : 3;
  const logo = await loadLogoDataUrl().catch(() => null);

  // Encabezado: logo, empresa, título, alcance y conteo, con la línea naranja.
  let y = MARGEN_PDF;
  const LOGO = 58;
  if (logo) { try { doc.addImage(logo, 'JPEG', MARGEN_PDF, y, LOGO, LOGO); } catch { /* opcional */ } }
  const tx = logo ? MARGEN_PDF + LOGO + 16 : MARGEN_PDF;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(150, 90, 0);
  doc.text('MINERAL GROUP GUAYANA C.A.', tx, y + 14);
  doc.setTextColor(20); doc.setFontSize(16);
  doc.text('Resumen de nómina', tx, y + 36);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(90);
  const alcance = doc.splitTextToSize(textoPdf(meta.alcance), util - (tx - MARGEN_PDF)) as string[];
  doc.text(alcance[0] ?? '', tx, y + 52);
  doc.text(textoPdf(subtitulo(t, filas)), tx, y + 64);
  doc.setTextColor(0);
  y += LOGO + 16;
  doc.setDrawColor(255, 138, 0); doc.setLineWidth(1.5);
  doc.line(MARGEN_PDF, y, W - MARGEN_PDF, y);
  y += 16;

  // Columnas proporcionales a su ancho sugerido, dentro de los 2 cm de margen.
  const columnStyles: Record<number, { cellWidth: number; halign?: 'right' | 'center' | 'left' }> = { 0: { cellWidth: util * (ANCHO_N / anchoTotal), halign: 'center' } };
  t.columnas.forEach((c, i) => {
    columnStyles[i + 1] = { cellWidth: util * (c.ancho / anchoTotal), halign: c.tipo === 'texto' ? 'left' : 'right' };
  });
  const celda = (v: string | number, j: number) => textoPdf(formatearValor(j === 0 ? null : t.columnas[j - 1], v));

  autoTable(doc, {
    startY: y,
    head: [t.head.map((h) => textoPdf(h))],
    body: t.filas.map((f) => f.map(celda)),
    // La fila de totales va en negrita y gris, una sola vez, al final de la tabla.
    foot: [t.totales.map(celda)],
    showFoot: 'lastPage',
    theme: 'grid',
    headStyles: { fillColor: [255, 138, 0], textColor: 255, fontStyle: 'bold', fontSize: letra, halign: 'center', valign: 'middle', lineColor: [60, 60, 60], lineWidth: 0.75 },
    footStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: 'bold', fontSize: letra, lineColor: [60, 60, 60], lineWidth: 0.75 },
    styles: { fontSize: letra, cellPadding: relleno, overflow: 'linebreak', valign: 'middle', lineColor: [60, 60, 60], lineWidth: 0.75, textColor: 20 },
    alternateRowStyles: { fillColor: [246, 246, 246] },
    columnStyles,
    // Abajo deja lugar al número de página, que va sobre la línea de los 2 cm.
    margin: { ...MARGENES_TABLA_PDF, bottom: MARGEN_PDF + 14 },
    didParseCell: (data) => {
      // Los totales alineados como su columna (los números a la derecha).
      if (data.section === 'foot') data.cell.styles.halign = columnStyles[data.column.index]?.halign ?? 'left';
    },
    didDrawPage: () => {
      const n = doc.getNumberOfPages();
      doc.setFontSize(8); doc.setTextColor(120);
      doc.text(`Página ${n}`, W - MARGEN_PDF, limiteInferiorPdf(H), { align: 'right' });
      doc.setTextColor(0);
    },
  });
  previewPdfDoc(doc, nombreArchivo('pdf'));
}
