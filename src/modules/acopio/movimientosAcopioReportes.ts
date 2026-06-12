/* ============================================================
   Golden Touch · Centro de Acopio · Movimientos · Reportes
   PDF / Excel / Correo de la lista de movimientos del acopio.
   Columnas (réplica del Excel «caja» de acopio):
   Fecha, Descripción, $Usd entregado, Kg Cerrados, Precio $Usd por Kg,
   $Usd Facturados, Gastos GT, Nóminas GT, Traslado de caja,
   Saldo en moneda $ Usd, Kg Recibidos por MGG, Saldo en Kg de casiterita.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';

export interface MovAcopioRow {
  fecha: string;
  descripcion: string;
  usdEntregado: number | null;
  kgCerrados: number;
  precioUsdKg: number | null;
  usdFacturados: number;
  gastosGt: number | null;
  nominasGt: number | null;
  trasladoCaja: number | null;
  saldoUsd: number;
  kgRecibidosMgg: number | null;
  saldoKgCasiterita: number;
}

export interface MovAcopioMeta { filtro?: string }

const NOMBRE = 'movimientos-centro-acopio';
const fmtNum = (v: number | null | undefined) =>
  v == null ? '' : v.toLocaleString('es', { maximumFractionDigits: 2 });
const fmtUsd = (v: number | null | undefined) =>
  v == null ? '' : `$${v.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const HEAD = [
  'Fecha', 'Descripción', '$Usd entregado', 'Kg Cerrados', 'Precio $Usd/Kg', '$Usd Facturados',
  'Gastos GT', 'Nóminas GT', 'Saldo $ Usd', 'Kg Recib. MGG', 'Saldo Kg casiterita',
];

async function construirDoc(rows: MovAcopioRow[], meta: MovAcopioMeta = {}) {
  const [{ dateTime }, { loadLogoDataUrl }, { jsPDF }, { default: autoTable }] = await Promise.all([
    import('@/shared/lib/format'), import('@/shared/lib/pdfLogo'), import('jspdf'), import('jspdf-autotable'),
  ]);
  const logo = await loadLogoDataUrl().catch(() => null);

  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  const PAGE_W = doc.internal.pageSize.getWidth();
  const MARGIN = 28;
  let y = MARGIN;
  if (logo) { try { doc.addImage(logo, 'JPEG', MARGIN, y, 46, 46); } catch { /* opcional */ } }
  const tx = logo ? MARGIN + 58 : MARGIN;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text('Movimientos del Centro de Acopio', tx, y + 18);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text('Saldo Kg casiterita = saldo anterior + Kg Cerrados − Kg Recibidos por MGG', tx, y + 33);
  doc.text(`GOLDEN TOUCH 1127 C.A. · ${dateTime(new Date().toISOString())}`, PAGE_W - MARGIN, y + 18, { align: 'right' });
  doc.text(`${rows.length} movimiento(s)${meta.filtro ? ` · ${meta.filtro}` : ''}`, PAGE_W - MARGIN, y + 33, { align: 'right' });
  y += 54;
  doc.setDrawColor(255, 138, 0); doc.setLineWidth(1.5); doc.line(MARGIN, y, PAGE_W - MARGIN, y); y += 8;

  const body = rows.map((r) => [
    r.fecha, r.descripcion, fmtUsd(r.usdEntregado), fmtNum(r.kgCerrados), fmtUsd(r.precioUsdKg), fmtUsd(r.usdFacturados),
    fmtUsd(r.gastosGt), fmtUsd(r.nominasGt), fmtUsd(r.saldoUsd), fmtNum(r.kgRecibidosMgg), fmtNum(r.saldoKgCasiterita),
  ]);
  const totKg = rows.reduce((a, r) => a + r.kgCerrados, 0);
  const totMgg = rows.reduce((a, r) => a + (r.kgRecibidosMgg ?? 0), 0);
  const saldoFinal = rows.length ? rows[rows.length - 1].saldoKgCasiterita : 0;
  body.push(['', 'TOTALES', '', fmtNum(totKg), '', '', '', '', '', totMgg ? fmtNum(totMgg) : '', fmtNum(saldoFinal)]);

  autoTable(doc, {
    startY: y + 4,
    head: [HEAD],
    body,
    margin: { left: MARGIN, right: MARGIN },
    styles: { fontSize: 7.5, cellPadding: 3 },
    headStyles: { fillColor: [255, 138, 0], textColor: 255, fontStyle: 'bold' },
    columnStyles: {
      2: { halign: 'right' }, 3: { halign: 'right', fontStyle: 'bold' }, 4: { halign: 'right' }, 5: { halign: 'right' },
      6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' }, 9: { halign: 'right' },
      10: { halign: 'right', fontStyle: 'bold' },
    },
    didParseCell: (data) => { if (data.row.index === body.length - 1) { data.cell.styles.fontStyle = 'bold'; data.cell.styles.fillColor = [245, 245, 245]; } },
  });
  return doc;
}

export async function descargarMovAcopioPdf(rows: MovAcopioRow[], meta: MovAcopioMeta = {}): Promise<void> {
  (await construirDoc(rows, meta)).save(`${NOMBRE}.pdf`);
}

export async function descargarMovAcopioExcel(rows: MovAcopioRow[]): Promise<void> {
  const [XLSXmod, { dateTime }] = await Promise.all([import('xlsx-js-style'), import('@/shared/lib/format')]);
  const XLSX = XLSXmod as unknown as {
    utils: { aoa_to_sheet: (d: unknown[][]) => Record<string, unknown>; encode_cell: (c: { r: number; c: number }) => string; book_new: () => unknown; book_append_sheet: (wb: unknown, ws: unknown, name: string) => void };
    writeFile: (wb: unknown, name: string) => void;
  };
  const HEADER = { font: { name: 'Arial', sz: 11, bold: true, color: { rgb: 'FFFFFF' } }, fill: { patternType: 'solid', fgColor: { rgb: 'FF8A00' } }, alignment: { horizontal: 'center' } };
  const TITLE = { ...HEADER, font: { ...HEADER.font, sz: 14 }, alignment: { horizontal: 'left' } };
  const filas = rows.map((r) => [
    r.fecha, r.descripcion, r.usdEntregado ?? '', r.kgCerrados, r.precioUsdKg ?? '', r.usdFacturados,
    r.gastosGt ?? '', r.nominasGt ?? '', r.saldoUsd, r.kgRecibidosMgg ?? '', r.saldoKgCasiterita,
  ]);
  const aoa: unknown[][] = [['MOVIMIENTOS DEL CENTRO DE ACOPIO · GOLDEN TOUCH 1127 C.A.'], [`${rows.length} movimiento(s) · ${dateTime(new Date().toISOString())}`], [], HEAD, ...filas];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  (ws as Record<string, unknown>)['!cols'] = [
    { wch: 12 }, { wch: 26 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 14 },
    { wch: 12 }, { wch: 12 }, { wch: 13 }, { wch: 13 }, { wch: 16 },
  ];
  (ws as Record<string, unknown>)['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 10 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 10 } }];
  const cellAt = (r: number, c: number) => (ws as Record<string, { s?: unknown }>)[XLSX.utils.encode_cell({ r, c })];
  const t = cellAt(0, 0); if (t) t.s = TITLE;
  HEAD.forEach((_, c) => { const cell = cellAt(3, c); if (cell) cell.s = HEADER; });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Movimientos');
  XLSX.writeFile(wb, `${NOMBRE}.xlsx`);
}

export async function enviarMovAcopioPorCorreo(rows: MovAcopioRow[], destinos: string[], meta: MovAcopioMeta = {}): Promise<{ destinatarios: string[] }> {
  const base64 = (await construirDoc(rows, meta)).output('datauristring').split(',')[1] ?? '';
  const { data, error } = await supabase.functions.invoke<{ ok: true; destinatarios: string[] } | { error: string }>('enviar-reporte', {
    body: { pdf_base64: base64, nombre_archivo: `${NOMBRE}.pdf`, asunto: `Movimientos del Centro de Acopio${meta.filtro ? ` · ${meta.filtro}` : ''}`, mensaje: `Movimientos del centro de acopio (${rows.length} movimiento(s)).`, to_emails: destinos },
  });
  if (error) throw new Error(error.message ?? 'No se pudo enviar el correo');
  if (!data || 'error' in data) throw new Error((data as { error?: string })?.error || 'Respuesta inválida');
  return { destinatarios: data.destinatarios };
}
