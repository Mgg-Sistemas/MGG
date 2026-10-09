/* ============================================================
   MGG · RRHH · Vacaciones y descansos · PDF y Excel (09-10-2026)

   El mismo cuadro en dos formatos, con el estilo de la casa (logo, razón
   social, raya naranja, cabecera naranja, filas alternadas). Un solo armador
   para las dos listas: cambian las columnas y el título, no el formato.

   Solo por botón y en vista previa: acá nunca se descarga nada solo.
   ============================================================ */
import { previewPdfDoc, previewWorkbook } from '@/shared/lib/reportPreview';
import { textoPdf } from '@/shared/lib/textoPdf';
import { MARGEN_PDF, MARGENES_TABLA_PDF, anchoUtilPdf, limiteInferiorPdf } from '@/shared/lib/pdfMargen';
import { date as fmtDate } from '@/shared/lib/format';
import { totalDias, type FilaDescanso, type FilaVacacion } from './calendarioRrhh';

const EMPRESA = 'MINERAL GROUP GUAYANA C.A.';
const hoyTxt = () => new Date().toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const slug = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

interface Cuadro {
  titulo: string;
  subtitulo: string;
  cabecera: string[];
  filas: (string | number)[][];
  /** Pesos relativos de las columnas (PDF). */
  pesos: number[];
  /** Anchos en caracteres (Excel). */
  anchos: number[];
  /** Índices de columnas numéricas (derecha) y centradas. */
  derecha?: number[];
  centro?: number[];
  /** Pie: una línea de resumen. */
  pie: string;
  /** Texto cuando no hay filas. */
  vacio: string;
  /** Qué se cuenta en el subtítulo: «vacación(es)», «descanso(s)». */
  unidad: string;
  hoja: string;
}

const CAB_VAC = ['Empleado', 'Cédula', 'Departamento', 'Cargo', 'Desde', 'Hasta', 'Días', 'Estado', 'Cruce', 'Nota', 'Cargado por'];
const CAB_DES = ['Empleado', 'Cédula', 'Departamento', 'Cargo', 'Desde', 'Hasta', 'Días', 'Origen', 'Nota', 'Cargado por'];

function cuadroVacaciones(filas: FilaVacacion[], o: { titulo: string; subtitulo: string }): Cuadro {
  const procesadas = filas.filter((f) => f.estado === 'Procesada').length;
  const cruces = filas.filter((f) => f.cruce).length;
  return {
    ...o,
    cabecera: CAB_VAC,
    filas: filas.map((f) => [f.empleado, f.cedula || '—', f.departamento || '—', f.cargo || '—', fmtDate(f.desde), fmtDate(f.hasta), f.dias, f.estado, f.cruce ? 'Sí' : '—', f.nota || '', f.cargadoPor || '—']),
    pesos: [16, 8, 11, 11, 7, 7, 5, 8, 5, 14, 9],
    anchos: [30, 14, 20, 22, 12, 12, 7, 12, 8, 36, 22],
    derecha: [6],
    centro: [8],
    pie: `${filas.length} vacación(es) · ${totalDias(filas)} día(s) en total · ${procesadas} procesada(s) · ${filas.length - procesadas} programada(s)${cruces ? ` · ${cruces} con cruce en el mismo departamento` : ''}`,
    vacio: 'Sin vacaciones para lo que se filtró.',
    unidad: 'vacación(es)',
    hoja: 'Vacaciones',
  };
}

function cuadroDescansos(filas: FilaDescanso[], o: { titulo: string; subtitulo: string; config?: string }): Cuadro {
  const plan = filas.filter((f) => f.origen === 'Plan').length;
  return {
    titulo: o.titulo,
    subtitulo: o.subtitulo,
    cabecera: CAB_DES,
    filas: filas.map((f) => [f.empleado, f.cedula || '—', f.departamento || '—', f.cargo || '—', fmtDate(f.desde), fmtDate(f.hasta), f.dias, f.origen, f.nota || '', f.cargadoPor || '—']),
    pesos: [17, 8, 11, 11, 7, 7, 5, 7, 16, 10],
    anchos: [30, 14, 20, 22, 12, 12, 7, 10, 36, 22],
    derecha: [6],
    centro: [7],
    pie: `${filas.length} descanso(s) · ${totalDias(filas)} día(s) en total · ${plan} del plan · ${filas.length - plan} manual(es)${o.config ? ` · rotación ${o.config}` : ''}`,
    vacio: 'Sin descansos para lo que se filtró.',
    unidad: 'descanso(s)',
    hoja: 'Descansos',
  };
}

async function verCuadroPdf(c: Cuadro): Promise<void> {
  const [{ jsPDF }, { default: autoTable }, { loadLogoDataUrl }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('@/shared/lib/pdfLogo'),
  ]);
  const logo = await loadLogoDataUrl().catch(() => null);
  // Muchas columnas: la hoja va acostada para que la nota se lea.
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
  doc.text(textoPdf(c.titulo), tx, y + 36);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(90);
  doc.text(textoPdf(`${c.subtitulo} · ${c.filas.length} ${c.unidad} · emitido el ${hoyTxt()}`), tx, y + 54);
  doc.setTextColor(0);
  y += LOGO + 14;
  doc.setDrawColor(255, 138, 0); doc.setLineWidth(1.5);
  doc.line(MARGEN_PDF, y, W - MARGEN_PDF, y);
  y += 18;

  const total = c.pesos.reduce((a, b) => a + b, 0);
  const util = anchoUtilPdf(W);
  const columnStyles: Record<number, { cellWidth: number; halign?: 'right' | 'center' }> = {};
  c.pesos.forEach((p, i) => {
    columnStyles[i] = {
      cellWidth: util * (p / total),
      ...((c.derecha ?? []).includes(i) ? { halign: 'right' as const } : (c.centro ?? []).includes(i) ? { halign: 'center' as const } : {}),
    };
  });

  autoTable(doc, {
    startY: y,
    head: [c.cabecera.map(textoPdf)],
    body: c.filas.map((f) => f.map(textoPdf)),
    theme: 'grid',
    headStyles: { fillColor: [255, 138, 0], textColor: 255, fontStyle: 'bold', fontSize: 7.5, halign: 'center', valign: 'middle', lineColor: [60, 60, 60], lineWidth: 0.75 },
    styles: { fontSize: 7.5, cellPadding: 3, overflow: 'linebreak', valign: 'middle', lineColor: [60, 60, 60], lineWidth: 0.75, textColor: 20 },
    alternateRowStyles: { fillColor: [246, 246, 246] },
    columnStyles,
    margin: { ...MARGENES_TABLA_PDF, bottom: MARGEN_PDF + 14 },
    didParseCell: (d) => {
      // «Sí» en la columna de cruce va en naranja, igual que en el calendario.
      if (d.section === 'body' && (c.centro ?? []).includes(d.column.index) && String(d.cell.raw ?? '') === 'Sí') {
        d.cell.styles.textColor = [200, 110, 0];
        d.cell.styles.fontStyle = 'bold';
      }
    },
    didDrawPage: () => {
      const n = doc.getNumberOfPages();
      doc.setFontSize(8); doc.setTextColor(120);
      doc.text(textoPdf(c.pie), MARGEN_PDF, limiteInferiorPdf(H));
      doc.text(`Página ${n}`, W - MARGEN_PDF, limiteInferiorPdf(H), { align: 'right' });
      doc.setTextColor(0);
    },
  });
  if (!c.filas.length) {
    doc.setFontSize(10); doc.setTextColor(120);
    doc.text(textoPdf(c.vacio), MARGEN_PDF, y + 30);
  }
  previewPdfDoc(doc, `${slug(c.titulo)}-${new Date().toISOString().slice(0, 10)}.pdf`);
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

async function verCuadroExcel(c: Cuadro): Promise<void> {
  const XLSXmod = await import('xlsx-js-style');
  const XLSX = XLSXmod as unknown as {
    utils: {
      aoa_to_sheet: (d: unknown[][]) => Record<string, unknown>;
      encode_cell: (c: { r: number; c: number }) => string;
      book_new: () => unknown;
      book_append_sheet: (wb: unknown, ws: unknown, name: string) => void;
    };
  };
  const aoa: unknown[][] = [
    [`${c.titulo.toUpperCase()} · MGG`],
    [`${c.subtitulo} · ${c.filas.length} ${c.unidad} · ${hoyTxt()}`],
    [],
    c.cabecera,
    ...c.filas,
    [],
    [c.pie],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  (ws as Record<string, unknown>)['!cols'] = c.anchos.map((wch) => ({ wch }));
  const ultimaCol = c.cabecera.length - 1;
  (ws as Record<string, unknown>)['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: ultimaCol } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: ultimaCol } },
    { s: { r: 5 + c.filas.length, c: 0 }, e: { r: 5 + c.filas.length, c: ultimaCol } },
  ];
  const cellAt = (r: number, col: number) => (ws as Record<string, { s?: unknown }>)[XLSX.utils.encode_cell({ r, c: col })];
  const tituloCell = cellAt(0, 0); if (tituloCell) tituloCell.s = TITLE_STYLE;
  c.cabecera.forEach((_, col) => { const cell = cellAt(3, col); if (cell) cell.s = HEADER_STYLE; });
  c.filas.forEach((f, i) => f.forEach((_, col) => {
    const cell = cellAt(4 + i, col);
    if (!cell) return;
    const h = (c.derecha ?? []).includes(col) ? 'right' : (c.centro ?? []).includes(col) ? 'center' : undefined;
    cell.s = h ? { ...CELDA_STYLE, alignment: { ...CELDA_STYLE.alignment, horizontal: h } } : CELDA_STYLE;
  }));
  (ws as Record<string, unknown>)['!rows'] = [{ hpt: 24 }, { hpt: 18 }, { hpt: 8 }, { hpt: 22 }, ...c.filas.map(() => ({ hpt: 18 }))];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, c.hoja);
  previewWorkbook(XLSX, wb, `${slug(c.titulo)}-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export interface OpcionesCalendarioReporte {
  /** «Vacaciones · octubre de 2026» o «Vacaciones · todas». */
  titulo: string;
  /** Alcance: mes, departamento, búsqueda. */
  subtitulo: string;
}

export function verVacacionesPdf(filas: FilaVacacion[], o: OpcionesCalendarioReporte): Promise<void> {
  return verCuadroPdf(cuadroVacaciones(filas, o));
}
export function verVacacionesExcel(filas: FilaVacacion[], o: OpcionesCalendarioReporte): Promise<void> {
  return verCuadroExcel(cuadroVacaciones(filas, o));
}
export function verDescansosPdf(filas: FilaDescanso[], o: OpcionesCalendarioReporte & { config?: string }): Promise<void> {
  return verCuadroPdf(cuadroDescansos(filas, o));
}
export function verDescansosExcel(filas: FilaDescanso[], o: OpcionesCalendarioReporte & { config?: string }): Promise<void> {
  return verCuadroExcel(cuadroDescansos(filas, o));
}
