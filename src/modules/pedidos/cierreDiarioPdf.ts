/* ============================================================
   MGG · Compras · Cierre diario (PDF) · 21-10-2026
   Una hoja: logo, título, período, FECHA Y HORA DE IMPRESIÓN y los cuatro títulos con su
   cantidad. Mismos estilos que el resto de los reportes (logo, 2 cm de margen, pie).
   Se MUESTRA en vista previa: nada se descarga solo.
   ============================================================ */
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import { MARGEN_PDF, MARGENES_TABLA_PDF, anchoUtilPdf, limiteInferiorPdf } from '@/shared/lib/pdfMargen';
import { fechaReporteTexto } from './comprasReporteMensaje';
import { fmtMonto } from './comprasReporte';
import type { ResumenCierre } from './cierreDiario';

export async function descargarCierreDiarioPdf(r: ResumenCierre, impresoIso: string = new Date().toISOString()): Promise<void> {
  const [{ jsPDF }, { default: autoTable }, { loadLogoDataUrl }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('@/shared/lib/pdfLogo'),
  ]);
  const logo = await loadLogoDataUrl().catch(() => null);
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const CW = anchoUtilPdf(W);
  let y = MARGEN_PDF;

  if (logo) { try { doc.addImage(logo, 'JPEG', MARGEN_PDF, y, 44, 44); } catch { /* opcional */ } }
  doc.setTextColor(255, 138, 0); doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text('CIERRE DIARIO · COMPRAS', W / 2 + 28, y + 20, { align: 'center' });
  doc.setTextColor(120, 120, 120); doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
  doc.text('Mineral Group Guayana C.A.', W / 2 + 28, y + 36, { align: 'center' });
  doc.setTextColor(0, 0, 0);
  y += 66;

  // Período y fecha/hora de impresión.
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text('Período:', MARGEN_PDF, y);
  doc.setFont('helvetica', 'normal');
  doc.text(r.rango.etiqueta, MARGEN_PDF + 52, y);
  y += 22;
  doc.setFont('helvetica', 'bold');
  doc.text('Impreso:', MARGEN_PDF, y);
  doc.setFont('helvetica', 'normal');
  doc.text(fechaReporteTexto(impresoIso), MARGEN_PDF + 52, y);
  y += 28;

  const wCant = 110;
  autoTable(doc, {
    startY: y,
    head: [['CONCEPTO', 'CANTIDAD']],
    body: r.items.map((i) => [i.titulo, String(i.cantidad)]),
    styles: { fontSize: 11, cellPadding: 10, minCellHeight: 28, valign: 'middle' },
    headStyles: { fillColor: [255, 224, 189], textColor: [138, 75, 0], fontStyle: 'bold', halign: 'center' },
    bodyStyles: { textColor: [20, 20, 20] },
    alternateRowStyles: { fillColor: [255, 246, 236] },
    tableWidth: CW,
    columnStyles: { 0: { cellWidth: CW - wCant }, 1: { halign: 'center', cellWidth: wCant, fontStyle: 'bold', fontSize: 13 } },
    margin: { ...MARGENES_TABLA_PDF },
  });

  let finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? (y + 150);

  // Detalle de las OC pendientes por pagar: orden, proveedor, monto en $ y total.
  const det = r.porPagarDetalle;
  if (det && det.filas.length > 0) {
    let yd = finalY + 28;
    if (yd + 80 > limiteInferiorPdf(H)) { doc.addPage(); yd = MARGEN_PDF + 14; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(255, 138, 0);
    doc.text(`DETALLE · ÓRDENES POR PAGAR (${det.filas.length})`, MARGEN_PDF, yd);
    doc.setTextColor(0, 0, 0);
    const wMonto = 120;
    const wNum = 30;
    const wOrden = 100;
    autoTable(doc, {
      startY: yd + 12,
      head: [['#', 'ORDEN', 'PROVEEDOR', 'MONTO $']],
      body: det.filas.map((f, i) => [String(i + 1), f.codigo, f.proveedor, f.montoUsd == null ? 'Sin tasa BCV' : fmtMonto(f.montoUsd, 'USD')]),
      foot: [['', '', 'TOTAL PENDIENTE POR PAGAR', fmtMonto(det.totalUsd, 'USD')]],
      showFoot: 'lastPage',
      styles: { fontSize: 10, cellPadding: 7, valign: 'middle' },
      headStyles: { fillColor: [255, 224, 189], textColor: [138, 75, 0], fontStyle: 'bold', halign: 'center', fontSize: 10 },
      footStyles: { fillColor: [255, 224, 189], textColor: [138, 75, 0], fontStyle: 'bold', fontSize: 11 },
      bodyStyles: { textColor: [20, 20, 20] },
      alternateRowStyles: { fillColor: [255, 246, 236] },
      tableWidth: CW,
      columnStyles: {
        0: { cellWidth: wNum, halign: 'center' },
        1: { cellWidth: wOrden },
        2: { cellWidth: CW - wNum - wOrden - wMonto },
        3: { cellWidth: wMonto, halign: 'right', fontStyle: 'bold' },
      },
      margin: { ...MARGENES_TABLA_PDF },
    });
    finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? (yd + 100);
    if (det.enBs > 0) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(90, 90, 90);
      doc.text(
        det.tasa > 0
          ? `${det.enBs} orden(es) en Bs pasada(s) a $ con la tasa BCV del día: ${fmtMonto(det.tasa, 'Bs')} por $.`
          : `${det.sinTasa} orden(es) en Bs no suman al total: no hay tasa BCV disponible.`,
        MARGEN_PDF, finalY + 14,
      );
      doc.setTextColor(0, 0, 0);
      finalY += 14;
    }
  }

  if (r.analistas && r.analistas.length > 0) {
    let y2 = finalY + 28;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(255, 138, 0);
    doc.text('ACTIVIDAD POR ANALISTA', MARGEN_PDF, y2);
    doc.setTextColor(0, 0, 0);
    y2 += 12;

    const wCol = 130;
    autoTable(doc, {
      startY: y2,
      head: [['ANALISTA', 'COTIZACIONES CARGADAS', 'ÓRDENES FINALIZADAS']],
      body: [
        ...r.analistas.map((a) => [a.nombre, String(a.cotizaciones), String(a.ordenesFinalizadas)]),
        ['TOTAL', String(r.totalCotizaciones ?? 0), String(r.totalFinalizadas ?? 0)],
      ],
      styles: { fontSize: 10, cellPadding: 8, minCellHeight: 25, valign: 'middle' },
      headStyles: { fillColor: [255, 224, 189], textColor: [138, 75, 0], fontStyle: 'bold', halign: 'center', fontSize: 10 },
      bodyStyles: { textColor: [20, 20, 20] },
      alternateRowStyles: { fillColor: [255, 246, 236] },
      tableWidth: CW,
      columnStyles: {
        0: { cellWidth: CW - wCol * 2 },
        1: { halign: 'center', cellWidth: wCol, fontStyle: 'bold' },
        2: { halign: 'center', cellWidth: wCol, fontStyle: 'bold' },
      },
      margin: { ...MARGENES_TABLA_PDF },
    });
  }

  doc.setFontSize(8); doc.setTextColor(120, 120, 120); doc.setFont('helvetica', 'normal');
  doc.text(`Impreso ${fechaReporteTexto(impresoIso)} · Órdenes de compra y servicios (no incluye compras ni servicios directos) · Mineral Group Guayana C.A.`, MARGEN_PDF, limiteInferiorPdf(H));

  previewPdfDoc(doc, 'cierre-diario-compras.pdf');
}
