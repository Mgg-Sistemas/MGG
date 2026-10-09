/* ============================================================
   MGG · RRHH · Histórico salarial · PDF y Excel (09-10-2026)

   El mismo cuadro en dos formatos: cada cambio de sueldo con la persona, su
   cédula y cargo, de cuánto a cuánto, la variación en %, el motivo, desde
   cuándo rige y quién lo cargó.

   Sirve para UNA persona (desde su ficha) o para TODOS (desde «📜 Histórico
   salarial», con los filtros que estén puestos). Solo por botón y en vista
   previa: acá nunca se descarga nada solo.
   ============================================================ */
import { previewPdfDoc, previewWorkbook } from '@/shared/lib/reportPreview';
import { textoPdf } from '@/shared/lib/textoPdf';
import { MARGEN_PDF, MARGENES_TABLA_PDF, anchoUtilPdf, limiteInferiorPdf } from '@/shared/lib/pdfMargen';
import { date as fmtDate, dateTime as fmtDateTime } from '@/shared/lib/format';
import { textoPct, type RenglonHistoricoSalarial } from './historicoSalarial';

const EMPRESA = 'MINERAL GROUP GUAYANA C.A.';
const usd = (v: unknown) => (Number(v) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hoyTxt = () => new Date().toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const slug = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

export interface OpcionesHistoricoReporte {
  /** «Histórico salarial · Ana Pérez» o «Histórico salarial · Todo el personal». */
  titulo: string;
  /** Qué se está mirando: rango, cargo, búsqueda. */
  subtitulo: string;
}

const CABECERA = ['Fecha del cambio', 'Empleado', 'Cédula', 'Cargo', 'Sueldo anterior', 'Sueldo nuevo', 'Variación %', 'Motivo', 'Vigente desde', 'Cambiado por'];

/** Las celdas de un renglón, ya en texto (lo que va igual al PDF y al Excel). */
function celdas(r: RenglonHistoricoSalarial): (string | number)[] {
  return [
    r.fechaCambio ? fmtDateTime(r.fechaCambio) : '—',
    r.empleado,
    r.cedula || '—',
    r.cargo || '—',
    r.sueldoAnterior,
    r.sueldoNuevo,
    textoPct(r.variacion),
    r.motivo,
    fmtDate(r.vigenteDesde),
    r.cambiadoPor || '—',
  ];
}

export async function verHistoricoSalarialPdf(filas: RenglonHistoricoSalarial[], o: OpcionesHistoricoReporte): Promise<void> {
  const [{ jsPDF }, { default: autoTable }, { loadLogoDataUrl }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('@/shared/lib/pdfLogo'),
  ]);
  const logo = await loadLogoDataUrl().catch(() => null);
  // Diez columnas: la hoja va acostada para que el motivo se lea.
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();

  let y = MARGEN_PDF;
  const LOGO = 58;
  if (logo) { try { doc.addImage(logo, 'JPEG', MARGEN_PDF, y, LOGO, LOGO); } catch { /* el logo es opcional */ } }
  const tx = logo ? MARGEN_PDF + LOGO + 16 : MARGEN_PDF;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(150, 90, 0);
  doc.text(EMPRESA, tx, y + 14);
  doc.setTextColor(20); doc.setFontSize(16);
  doc.text(textoPdf(o.titulo), tx, y + 36);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(90);
  doc.text(textoPdf(`${o.subtitulo} · ${filas.length} cambio(s) · emitido el ${hoyTxt()}`), tx, y + 54);
  doc.setTextColor(0);
  y += LOGO + 14;
  doc.setDrawColor(255, 138, 0); doc.setLineWidth(1.5);
  doc.line(MARGEN_PDF, y, W - MARGEN_PDF, y);
  y += 18;

  // Anchos relativos: el motivo y el empleado son los que más lugar necesitan.
  const pesos = [9, 14, 8, 12, 8, 8, 7, 20, 8, 10];
  const total = pesos.reduce((a, b) => a + b, 0);
  const util = anchoUtilPdf(W);
  const columnStyles: Record<number, { cellWidth: number; halign?: 'right' | 'center' }> = {};
  pesos.forEach((p, i) => {
    columnStyles[i] = { cellWidth: util * (p / total), ...(i === 4 || i === 5 ? { halign: 'right' as const } : i === 6 ? { halign: 'center' as const } : {}) };
  });

  autoTable(doc, {
    startY: y,
    head: [CABECERA.map(textoPdf)],
    body: filas.map((r) => celdas(r).map((v, j) => textoPdf(j === 4 || j === 5 ? (Number(v) > 0 ? usd(v) : '—') : v))),
    theme: 'grid',
    headStyles: { fillColor: [255, 138, 0], textColor: 255, fontStyle: 'bold', fontSize: 7.5, halign: 'center', valign: 'middle', lineColor: [60, 60, 60], lineWidth: 0.75 },
    styles: { fontSize: 7.5, cellPadding: 3, overflow: 'linebreak', valign: 'middle', lineColor: [60, 60, 60], lineWidth: 0.75, textColor: 20 },
    alternateRowStyles: { fillColor: [246, 246, 246] },
    columnStyles,
    margin: { ...MARGENES_TABLA_PDF, bottom: MARGEN_PDF + 14 },
    didParseCell: (d) => {
      // La variación en verde si sube y en rojo si baja, para leerla de un vistazo.
      if (d.section === 'body' && d.column.index === 6) {
        const t = String(d.cell.raw ?? '');
        if (t.startsWith('+')) d.cell.styles.textColor = [40, 150, 90];
        else if (t.startsWith('-')) d.cell.styles.textColor = [200, 60, 60];
      }
    },
    didDrawPage: () => {
      const n = doc.getNumberOfPages();
      doc.setFontSize(8); doc.setTextColor(120);
      doc.text(textoPdf('Un renglón del histórico no se edita ni se borra: si uno quedó mal, se registra otro cambio que lo corrija.'), MARGEN_PDF, limiteInferiorPdf(H));
      doc.text(`Página ${n}`, W - MARGEN_PDF, limiteInferiorPdf(H), { align: 'right' });
      doc.setTextColor(0);
    },
  });
  if (!filas.length) {
    doc.setFontSize(10); doc.setTextColor(120);
    doc.text(textoPdf('Sin cambios de sueldo para lo que se filtró.'), MARGEN_PDF, y + 30);
  }
  previewPdfDoc(doc, `${slug(o.titulo)}-${new Date().toISOString().slice(0, 10)}.pdf`);
}

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
const CELDA_STYLE = {
  font: { name: 'Arial', sz: 10 },
  alignment: { vertical: 'center', wrapText: true },
  border: HEADER_STYLE.border,
};
const MONTO_STYLE = { ...CELDA_STYLE, numFmt: '#,##0.00', alignment: { horizontal: 'right', vertical: 'center' } };

export async function verHistoricoSalarialExcel(filas: RenglonHistoricoSalarial[], o: OpcionesHistoricoReporte): Promise<void> {
  const XLSXmod = await import('xlsx-js-style');
  const XLSX = XLSXmod as unknown as {
    utils: {
      aoa_to_sheet: (d: unknown[][]) => Record<string, unknown>;
      encode_cell: (c: { r: number; c: number }) => string;
      book_new: () => unknown;
      book_append_sheet: (wb: unknown, ws: unknown, name: string) => void;
    };
  };
  const cuerpo = filas.map((r) => celdas(r).map((v, j) => ((j === 4 || j === 5) && Number(v) <= 0 ? '' : v)));
  const aoa: unknown[][] = [
    [`${o.titulo.toUpperCase()} · MGG`],
    [`${o.subtitulo} · ${filas.length} cambio(s) · ${hoyTxt()}`],
    [],
    CABECERA,
    ...cuerpo,
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  (ws as Record<string, unknown>)['!cols'] = [18, 28, 14, 24, 14, 14, 11, 44, 13, 22].map((wch) => ({ wch }));
  const ultimaCol = CABECERA.length - 1;
  (ws as Record<string, unknown>)['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: ultimaCol } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: ultimaCol } },
  ];
  const cellAt = (r: number, c: number) => (ws as Record<string, { s?: unknown }>)[XLSX.utils.encode_cell({ r, c })];
  const tituloCell = cellAt(0, 0); if (tituloCell) tituloCell.s = TITLE_STYLE;
  CABECERA.forEach((_, c) => { const cell = cellAt(3, c); if (cell) cell.s = HEADER_STYLE; });
  cuerpo.forEach((f, i) => f.forEach((_, c) => {
    const cell = cellAt(4 + i, c);
    if (cell) cell.s = c === 4 || c === 5 ? MONTO_STYLE : c === 6 ? { ...CELDA_STYLE, alignment: { horizontal: 'center', vertical: 'center' } } : CELDA_STYLE;
  }));
  (ws as Record<string, unknown>)['!rows'] = [{ hpt: 24 }, { hpt: 18 }, { hpt: 8 }, { hpt: 22 }, ...cuerpo.map(() => ({ hpt: 18 }))];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Histórico salarial');
  previewWorkbook(XLSX, wb, `${slug(o.titulo)}-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
