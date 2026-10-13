/* ============================================================
   MGG · RRHH · Tabulador por cargo · PDF y Excel (13-10-2026)

   El tabulador impreso: cargo, personas activas, SUELDO ANTERIOR, SUELDO
   NUEVO, variación en % y desde cuándo rige. Sirve tanto para el tabulador
   vigente (anterior = lo que decía antes del último cambio) como para la
   propuesta que se arma desde los cargos (anterior = lo que hay hoy, nuevo =
   lo que se va a cargar). Solo por botón, en vista previa; nada automático.
   ============================================================ */
import { money, date, dateTime } from '@/shared/lib/format';
import { previewPdfDoc, previewWorkbook } from '@/shared/lib/reportPreview';
import { MARGEN_PDF, MARGENES_TABLA_PDF } from '@/shared/lib/pdfMargen';
import { loadLogoDataUrl } from '@/shared/lib/pdfLogo';
import { variacionSueldo } from './cambioSueldo';
import { textoPct } from './historicoSalarial';
import type { FilaExportTabulador } from './tabulador';

const EMPRESA = 'Mineral Group Guayana C.A.';
const RIF = 'J-50221930-7';

export interface MetaExportTabulador {
  /** «Tabulador de sueldos por cargo» o «Propuesta de tabulador». */
  titulo: string;
  /** Línea bajo el título (p. ej. el motivo). */
  subtitulo?: string | null;
  /** Desde cuándo rigen los montos nuevos (propuesta). */
  vigenteDesde?: string | null;
  emitidoPor?: string | null;
}

const CABECERA = ['Cargo', 'Personas activas', 'Sueldo anterior (USD/mes)', 'Sueldo nuevo (USD/mes)', 'Var. %', 'Vigente desde'];

function celdas(f: FilaExportTabulador): (string | number)[] {
  const v = variacionSueldo(f.anterior ?? 0, f.nuevo ?? 0);
  return [
    f.cargo,
    f.activos,
    f.anterior != null && f.anterior > 0 ? money(f.anterior) : '—',
    f.nuevo != null && f.nuevo > 0 ? money(f.nuevo) : 'Sin definir',
    f.anterior != null && f.anterior > 0 && f.nuevo != null ? textoPct(v) : '—',
    f.vigenteDesde ? date(f.vigenteDesde) : '—',
  ];
}

function nombreArchivo(meta: MetaExportTabulador, ext: string): string {
  const base = meta.titulo.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${base || 'tabulador'}-${new Date().toISOString().slice(0, 10)}.${ext}`;
}

function totales(filas: readonly FilaExportTabulador[]): { cargos: number; conMonto: number; suben: number; bajan: number; activos: number } {
  let conMonto = 0; let suben = 0; let bajan = 0; let activos = 0;
  for (const f of filas) {
    activos += f.activos;
    if (f.nuevo != null && f.nuevo > 0) conMonto += 1;
    if (f.anterior != null && f.anterior > 0 && f.nuevo != null) {
      const d = variacionSueldo(f.anterior, f.nuevo).direccion;
      if (d === 'aumento') suben += 1; else if (d === 'rebaja') bajan += 1;
    }
  }
  return { cargos: filas.length, conMonto, suben, bajan, activos };
}

export async function descargarTabuladorPdf(filas: readonly FilaExportTabulador[], meta: MetaExportTabulador): Promise<void> {
  const [{ jsPDF }, { default: autoTable }, logo] = await Promise.all([
    import('jspdf'), import('jspdf-autotable'), loadLogoDataUrl().catch(() => null),
  ]);
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const PAGE_W = doc.internal.pageSize.getWidth();
  const PAGE_H = doc.internal.pageSize.getHeight();
  const MARGIN = MARGEN_PDF;
  let y = MARGIN;

  // ── Membrete ──
  const LOGO = 50;
  if (logo) { try { doc.addImage(logo, 'JPEG', MARGIN, y, LOGO, LOGO); } catch { /* opcional */ } }
  const tx = logo ? MARGIN + LOGO + 12 : MARGIN;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(20);
  doc.text(EMPRESA, tx, y + 16);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(90);
  doc.text(`RIF: ${RIF} · Departamento de Recursos Humanos`, tx, y + 30);
  doc.text(`Emitido ${dateTime(new Date().toISOString())}${meta.emitidoPor ? ` · ${meta.emitidoPor}` : ''}`, tx, y + 43);
  doc.setTextColor(0);
  y += LOGO + 10;
  doc.setDrawColor(255, 138, 0); doc.setLineWidth(1.5); doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 24;

  // ── Título ──
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text(meta.titulo.toUpperCase(), PAGE_W / 2, y, { align: 'center' });
  y += 16;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(70);
  const sub: string[] = [];
  if (meta.vigenteDesde) sub.push(`Los montos nuevos rigen desde el ${date(meta.vigenteDesde)}`);
  if (meta.subtitulo) sub.push(meta.subtitulo);
  if (sub.length) { doc.text(sub.join(' · '), PAGE_W / 2, y, { align: 'center', maxWidth: PAGE_W - 2 * MARGIN }); y += 14; }
  const t = totales(filas);
  doc.text(`${t.cargos} cargo(s) · ${t.conMonto} con monto · ${t.suben} suben · ${t.bajan} bajan · ${t.activos} persona(s) activa(s)`, PAGE_W / 2, y, { align: 'center' });
  doc.setTextColor(0);
  y += 14;

  autoTable(doc, {
    startY: y,
    head: [CABECERA],
    body: filas.map(celdas),
    theme: 'striped',
    headStyles: { fillColor: [255, 138, 0], textColor: 255, fontSize: 8.5 },
    styles: { fontSize: 8.5, cellPadding: 4 },
    columnStyles: { 0: { fontStyle: 'bold' }, 1: { halign: 'center' }, 2: { halign: 'right' }, 3: { halign: 'right', fontStyle: 'bold' }, 4: { halign: 'center' }, 5: { halign: 'center' } },
    margin: MARGENES_TABLA_PDF,
    didDrawPage: () => {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(120);
      doc.text(`${EMPRESA} · ${meta.titulo} · pág. ${doc.getNumberOfPages()}`, PAGE_W / 2, PAGE_H - MARGIN / 2, { align: 'center' });
      doc.setTextColor(0);
    },
  });

  // ── Firmas ──
  const yFin = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y) + 48;
  const yFirma = yFin + 60 > PAGE_H - MARGIN ? (doc.addPage(), MARGIN + 40) : yFin;
  const ancho = (PAGE_W - 2 * MARGIN - 40) / 2;
  doc.setDrawColor(80); doc.setLineWidth(0.6);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(40);
  [['Elaborado por · Recursos Humanos', MARGIN], ['Aprobado por · Gerencia General', MARGIN + ancho + 40]].forEach(([txt, x]) => {
    doc.line(Number(x), yFirma, Number(x) + ancho, yFirma);
    doc.text(String(txt), Number(x) + ancho / 2, yFirma + 12, { align: 'center' });
  });
  doc.setTextColor(0);

  previewPdfDoc(doc, nombreArchivo(meta, 'pdf'));
}

export async function descargarTabuladorExcel(filas: readonly FilaExportTabulador[], meta: MetaExportTabulador): Promise<void> {
  const XLSXmod = await import('xlsx-js-style');
  const XLSX = XLSXmod as unknown as {
    utils: {
      aoa_to_sheet: (d: unknown[][]) => Record<string, unknown>;
      encode_cell: (c: { r: number; c: number }) => string;
      book_new: () => unknown;
      book_append_sheet: (wb: unknown, ws: unknown, name: string) => void;
    };
  };
  const HEADER = { font: { name: 'Arial', sz: 11, bold: true, color: { rgb: 'FFFFFF' } }, fill: { patternType: 'solid', fgColor: { rgb: 'FF8A00' } }, alignment: { horizontal: 'center', wrapText: true } };
  const TITLE = { font: { name: 'Arial', sz: 14, bold: true } };
  const t = totales(filas);
  const sub: string[] = [];
  if (meta.vigenteDesde) sub.push(`Rigen desde ${date(meta.vigenteDesde)}`);
  if (meta.subtitulo) sub.push(meta.subtitulo);
  sub.push(`${t.cargos} cargo(s) · ${t.suben} suben · ${t.bajan} bajan`);
  sub.push(`Emitido ${dateTime(new Date().toISOString())}${meta.emitidoPor ? ` · ${meta.emitidoPor}` : ''}`);
  // En Excel los montos van como número (para sumar y filtrar); el % como número también.
  const cuerpo = filas.map((f) => {
    const v = variacionSueldo(f.anterior ?? 0, f.nuevo ?? 0);
    return [
      f.cargo, f.activos,
      f.anterior != null && f.anterior > 0 ? f.anterior : '',
      f.nuevo != null && f.nuevo > 0 ? f.nuevo : 'Sin definir',
      f.anterior != null && f.anterior > 0 && f.nuevo != null && v.pct != null ? v.pct / 100 : '',
      f.vigenteDesde ? date(f.vigenteDesde) : '',
    ];
  });
  const aoa: unknown[][] = [[`${EMPRESA} · ${meta.titulo.toUpperCase()}`], [sub.join(' · ')], [], CABECERA, ...cuerpo];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const W = ws as Record<string, unknown>;
  W['!cols'] = [{ wch: 34 }, { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 9 }, { wch: 14 }];
  W['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } }];
  const cellAt = (r: number, c: number) => (ws as Record<string, { s?: unknown; z?: string; t?: string }>)[XLSX.utils.encode_cell({ r, c })];
  const titulo = cellAt(0, 0); if (titulo) titulo.s = TITLE;
  CABECERA.forEach((_, c) => { const cell = cellAt(3, c); if (cell) cell.s = HEADER; });
  filas.forEach((_, i) => {
    for (const c of [2, 3]) { const cell = cellAt(4 + i, c); if (cell && cell.t === 'n') cell.z = '#,##0.00'; }
    const pct = cellAt(4 + i, 4); if (pct && pct.t === 'n') pct.z = '+0.0%;-0.0%';
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Tabulador');
  previewWorkbook(XLSX, wb, nombreArchivo(meta, 'xlsx'));
}
