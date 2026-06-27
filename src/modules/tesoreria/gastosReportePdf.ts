/* ============================================================
   MGG · Tesorería · Reporte PDF de Gastos por categoría · subcategoría
   Categoría · Subcategoría · N° mov · totales por moneda. Vista previa.
   ============================================================ */
import { previewPdfDoc } from '@/shared/lib/reportPreview';

export interface GastoReporteRow {
  categoria: string;
  subcategoria: string;
  count: number;
  totales: Record<string, number>;
}

function monto(n: number | null | undefined, moneda: string): string {
  const v = Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return moneda === 'USD' ? `$ ${v}` : `${moneda} ${v}`;
}

export async function descargarReporteGastosPdf(
  rows: GastoReporteRow[],
  monedas: string[],
  opts: { desde?: string; hasta?: string } = {},
): Promise<void> {
  const [{ jsPDF }, { default: autoTable }, fmt, { loadLogoDataUrl }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('@/shared/lib/format'),
    import('@/shared/lib/pdfLogo'),
  ]);
  const logo = await loadLogoDataUrl().catch(() => null);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  const W = doc.internal.pageSize.getWidth();
  const MARGIN = 42.52; // 1,5 cm
  let y = MARGIN;
  if (logo) { try { doc.addImage(logo, 'JPEG', MARGIN, y, 44, 44); } catch { /* opcional */ } }

  doc.setTextColor(255, 138, 0); doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  doc.text('GASTOS POR CATEGORÍA · SUBCATEGORÍA', W / 2 + 28, y + 22, { align: 'center' });
  doc.setTextColor(90, 90, 90); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  const periodo = opts.desde || opts.hasta
    ? `Período: ${opts.desde ? fmt.date(opts.desde) : '—'} a ${opts.hasta ? fmt.date(opts.hasta) : '—'}`
    : 'Todos los gastos registrados';
  doc.text(periodo, W / 2 + 28, y + 38, { align: 'center' });
  doc.setTextColor(0, 0, 0);
  y += 56;

  const celda = (t: Record<string, number>, mon: string) => {
    const v = t[mon] || 0;
    return v ? monto(v, mon) : '—';
  };

  const body = rows.map((r, i) => [
    String(i + 1),
    r.categoria,
    r.subcategoria,
    String(r.count),
    ...monedas.map((mon) => celda(r.totales, mon)),
  ]);

  const sumPorMoneda: Record<string, number> = {};
  for (const r of rows) for (const mon of monedas) sumPorMoneda[mon] = Math.round(((sumPorMoneda[mon] || 0) + (r.totales[mon] || 0)) * 100) / 100;
  const totalMov = rows.reduce((a, r) => a + r.count, 0);

  autoTable(doc, {
    startY: y,
    head: [['ITEM', 'CATEGORÍA', 'SUBCATEGORÍA', 'MOV', ...monedas]],
    body,
    foot: [['', 'TOTAL', '', String(totalMov), ...monedas.map((mon) => celda(sumPorMoneda, mon))]],
    styles: { fontSize: 8, cellPadding: 3.5, valign: 'middle', overflow: 'linebreak' },
    headStyles: { fillColor: [210, 210, 210], textColor: [20, 20, 20], fontStyle: 'bold', halign: 'center' },
    footStyles: { fillColor: [255, 138, 0], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'right' },
    columnStyles: {
      0: { halign: 'center', cellWidth: 32 },
      1: { cellWidth: 165 },
      2: { cellWidth: 165 },
      3: { halign: 'center', cellWidth: 38 },
      ...Object.fromEntries(monedas.map((_, idx) => [4 + idx, { halign: 'right' as const }])),
    },
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  });

  doc.setFontSize(8); doc.setTextColor(120, 120, 120);
  doc.text(`Generado ${fmt.dateTime(new Date().toISOString())} · ${rows.length} subcategoría(s) · Mineral Group Guayana C.A.`, MARGIN, doc.internal.pageSize.getHeight() - 16);

  previewPdfDoc(doc, 'gastos-por-categoria.pdf');
}
