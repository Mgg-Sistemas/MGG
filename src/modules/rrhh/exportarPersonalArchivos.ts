/* ============================================================
   MGG · RRHH · Excel y PDF de los datos del personal (05-10-2026)
   Solo a pedido del usuario (botón), con vista previa antes de bajar.
   ============================================================ */
import type { Personal } from '@/shared/lib/types';
import { previewPdfDoc, previewWorkbook } from '@/shared/lib/reportPreview';
import { MARGEN_PDF, MARGENES_TABLA_PDF, anchoUtilPdf, limiteInferiorPdf } from '@/shared/lib/pdfMargen';
import { camposElegidos, tablaExport } from './exportarPersonal';

const HEADER_STYLE = {
  font: { name: 'Arial', sz: 11, bold: true, color: { rgb: 'FFFFFF' } },
  fill: { patternType: 'solid', fgColor: { rgb: 'FF8A00' } },
  alignment: { horizontal: 'left', vertical: 'center', wrapText: true },
  border: {
    top: { style: 'thin', color: { rgb: '000000' } }, bottom: { style: 'thin', color: { rgb: '000000' } },
    left: { style: 'thin', color: { rgb: '000000' } }, right: { style: 'thin', color: { rgb: '000000' } },
  },
};
const TITLE_STYLE = { font: { name: 'Arial', sz: 14, bold: true } };

const hoyTxt = () => new Date().toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const nombreArchivo = (ext: string) => `personal-${new Date().toISOString().slice(0, 10)}.${ext}`;

export async function descargarPersonalExcel(personas: Personal[], keys: string[], titulo: string): Promise<void> {
  const XLSXmod = await import('xlsx-js-style');
  const XLSX = XLSXmod as unknown as {
    utils: {
      aoa_to_sheet: (d: unknown[][]) => Record<string, unknown>;
      encode_cell: (c: { r: number; c: number }) => string;
      book_new: () => unknown;
      book_append_sheet: (wb: unknown, ws: unknown, name: string) => void;
    };
  };
  const { head, filas } = tablaExport(personas, keys);
  const aoa: unknown[][] = [
    [`PERSONAL · ${titulo.toUpperCase()} · MGG`],
    [`${personas.length} persona(s) · ${hoyTxt()}`],
    [],
    head,
    ...filas,
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  (ws as Record<string, unknown>)['!cols'] = [{ wch: 5 }, ...camposElegidos(keys).map((c) => ({ wch: c.ancho }))];
  const ultimaCol = Math.max(0, head.length - 1);
  (ws as Record<string, unknown>)['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: ultimaCol } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: ultimaCol } },
  ];
  const cellAt = (r: number, c: number) => (ws as Record<string, { s?: unknown }>)[XLSX.utils.encode_cell({ r, c })];
  const tituloCell = cellAt(0, 0); if (tituloCell) tituloCell.s = TITLE_STYLE;
  head.forEach((_, c) => { const cell = cellAt(3, c); if (cell) cell.s = HEADER_STYLE; });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Personal');
  previewWorkbook(XLSX, wb, nombreArchivo('xlsx'));
}

export async function descargarPersonalPdf(personas: Personal[], keys: string[], titulo: string): Promise<void> {
  const [{ jsPDF }, { default: autoTable }, { loadLogoDataUrl }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('@/shared/lib/pdfLogo'),
  ]);
  const campos = camposElegidos(keys);
  const { head, filas } = tablaExport(personas, keys);
  // Con muchas columnas, la hoja va acostada para que todo entre.
  const anchoTotal = 5 + campos.reduce((a, c) => a + c.ancho, 0);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: anchoTotal > 95 ? 'landscape' : 'portrait' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const logo = await loadLogoDataUrl().catch(() => null);

  let y = MARGEN_PDF;
  if (logo) { try { doc.addImage(logo, 'JPEG', MARGEN_PDF, y, 42, 42); } catch { /* opcional */ } }
  const tx = logo ? MARGEN_PDF + 54 : MARGEN_PDF;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  doc.text(`Personal · ${titulo}`, tx, y + 16);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(`MGG · ${personas.length} persona(s) · ${hoyTxt()}`, tx, y + 31);
  y += 54;

  // Columnas proporcionales a su ancho sugerido, dentro de los 2 cm de margen.
  const util = anchoUtilPdf(W);
  const columnStyles: Record<number, { cellWidth: number; halign?: 'right' | 'center' }> = { 0: { cellWidth: util * (5 / anchoTotal), halign: 'center' } };
  campos.forEach((c, i) => {
    columnStyles[i + 1] = { cellWidth: util * (c.ancho / anchoTotal), ...(c.key === 'sueldo_base' ? { halign: 'right' as const } : {}) };
  });

  autoTable(doc, {
    startY: y,
    head: [head],
    // El N° de renglón va tal cual; el sueldo, con dos decimales.
    body: filas.map((f) => f.map((v, j) => (j > 0 && typeof v === 'number' ? v.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(v)))),
    theme: 'grid',
    headStyles: { fillColor: [255, 138, 0], textColor: 255, fontSize: campos.length > 8 ? 7 : 9 },
    styles: { fontSize: campos.length > 8 ? 7 : 9, cellPadding: 3, overflow: 'linebreak' },
    columnStyles,
    // Abajo deja lugar al número de página, que va sobre la línea de los 2 cm.
    margin: { ...MARGENES_TABLA_PDF, bottom: MARGEN_PDF + 14 },
    didDrawPage: () => {
      const n = doc.getNumberOfPages();
      doc.setFontSize(8); doc.setTextColor(120);
      doc.text(`Página ${n}`, W - MARGEN_PDF, limiteInferiorPdf(H), { align: 'right' });
      doc.setTextColor(0);
    },
  });
  previewPdfDoc(doc, nombreArchivo('pdf'));
}
