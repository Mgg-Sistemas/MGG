/* ============================================================
   Golden Touch · Administración · PDF del reporte de gastos fijos
   Mismo estándar que Tesorería (ordenesPorPagarPdf): logo + encabezado
   «GOLDEN TOUCH 1127 C.A.», total en grande, y tablas Por categoría / Por
   empresa / Detalle. Vista previa (no descarga de una). Todo texto humano
   pasa por `pdfSafe` (las fuentes base de jsPDF no tienen emojis/acentos raros).
   ============================================================ */
import { previewPdf } from '@/shared/lib/reportePreview';
import { pdfSafe } from '@/shared/lib/pdfSafe';
import { dibujarLogoPdf } from '@/shared/lib/pdfLogo';
import { nombreArchivoReporteAdmin, estadoPagoLabel, origenLabel, ETIQUETA_DIMENSION, type ReporteAdminData } from './administracionReporte';

const bsNum = (n: number) => Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export async function descargarReporteAdminPdf(data: ReporteAdminData): Promise<void> {
  const [{ jsPDF }, { default: autoTable }, fmt, { loadLogoPdfDataUrl }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('@/shared/lib/format'),
    import('@/shared/lib/pdfLogo'),
  ]);
  const { meta, total, grupos, agruparPor, filas } = data;
  const tasa = meta.tasa;
  const dim = ETIQUETA_DIMENSION[agruparPor];

  const logo = await loadLogoPdfDataUrl().catch(() => null);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const MARGIN = 48;
  let y = MARGIN;
  if (logo) dibujarLogoPdf(doc, logo, MARGIN, y, 40);

  doc.setTextColor(255, 138, 0); doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  doc.text('REPORTE DE GASTOS FIJOS', W / 2 + 24, y + 18, { align: 'center' });
  doc.setTextColor(120, 120, 120); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(pdfSafe(`GOLDEN TOUCH 1127 C.A. · ${meta.empresaNombre || 'Todas las empresas'} · ${meta.alcanceLabel}`), W / 2 + 24, y + 33, { align: 'center' });
  doc.text(`Generado ${fmt.dateTime(meta.generadoEn)}${tasa > 0 ? ` · Tasa BCV: Bs ${bsNum(tasa)} / $` : ''}`, W / 2 + 24, y + 46, { align: 'center' });
  doc.setTextColor(0, 0, 0);
  y += 66;

  // ── Total en grande ──
  const boxH = 54;
  doc.setDrawColor(255, 138, 0); doc.setLineWidth(1.2); doc.setFillColor(255, 244, 232);
  doc.roundedRect(MARGIN, y, W - MARGIN * 2, boxH, 6, 6, 'FD');
  doc.setTextColor(60, 60, 60); doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
  doc.text(`TOTAL · ${total.n} movimiento(s)`, MARGIN + 14, y + 22);
  doc.setTextColor(120, 120, 120); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  doc.text(`${bsNum(total.bs)} Bs  ·  ${fmt.money(total.usd)}${tasa > 0 ? '  (equivalente en USD a la tasa del día)' : ''}`, MARGIN + 14, y + 40);
  doc.setTextColor(20, 20, 20); doc.setFont('helvetica', 'bold'); doc.setFontSize(22);
  doc.text(fmt.money(total.equivUsd), W - MARGIN - 14, y + 34, { align: 'right' });
  doc.setTextColor(0, 0, 0);
  y += boxH + 22;

  const finalY = () => (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y;
  const titulo = (t: string) => {
    if (y > H - 110) { doc.addPage(); y = MARGIN; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(255, 138, 0);
    doc.text(t, MARGIN, y); doc.setTextColor(0, 0, 0); y += 6;
  };
  // ── Desglose por la dimensión elegida ──
  titulo(`Por ${dim.toLowerCase()}`);
  autoTable(doc, {
    startY: y,
    head: [[dim.toUpperCase(), 'Bs', 'USD', 'EQUIV. $', 'MOV.']],
    body: grupos.map((g) => [pdfSafe(g.clave), bsNum(g.bs), fmt.money(g.usd), fmt.money(g.equivUsd), String(g.n)]),
    foot: [['TOTAL', bsNum(total.bs), fmt.money(total.usd), fmt.money(total.equivUsd), String(total.n)]],
    styles: { fontSize: 9, cellPadding: 4, valign: 'middle', overflow: 'linebreak' },
    headStyles: { fillColor: [210, 210, 210], textColor: [20, 20, 20], fontStyle: 'bold' },
    footStyles: { fillColor: [255, 244, 232], textColor: [20, 20, 20], fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right', cellWidth: 44 } },
    margin: { left: MARGIN, right: MARGIN },
  });
  y = finalY() + 18;

  // ── Detalle ──
  titulo('Detalle de movimientos');
  autoTable(doc, {
    startY: y,
    head: [['FECHA', 'EMPRESA', 'CONCEPTO', 'CATEGORÍA', 'MONTO', 'PERÍODO', 'ESTADO', 'ORIGEN']],
    body: filas.map((f) => [
      fmt.date(f.fecha), pdfSafe(f.empresa), pdfSafe(f.concepto), pdfSafe(f.categoria),
      `${bsNum(f.monto)} ${f.moneda}`, f.periodo, estadoPagoLabel(f.estadoPago), origenLabel(f.origen),
    ]),
    styles: { fontSize: 8, cellPadding: 3, valign: 'middle', overflow: 'linebreak' },
    headStyles: { fillColor: [210, 210, 210], textColor: [20, 20, 20], fontStyle: 'bold' },
    columnStyles: { 4: { halign: 'right' } },
    margin: { left: MARGIN, right: MARGIN },
  });

  previewPdf(doc, nombreArchivoReporteAdmin(meta.alcanceLabel, 'pdf'));
}
