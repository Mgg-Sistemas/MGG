/* ============================================================
   MGG · Compras · Cierre diario (PDF) · 21-10-2026
   Una hoja: logo, título, período, FECHA Y HORA DE IMPRESIÓN y los cuatro títulos con su
   cantidad. Mismos estilos que el resto de los reportes (logo, 2 cm de margen, pie).
   Se MUESTRA en vista previa: nada se descarga solo.
   ============================================================ */
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import { MARGEN_PDF, MARGENES_TABLA_PDF, anchoUtilPdf, limiteInferiorPdf } from '@/shared/lib/pdfMargen';
import { fechaReporteTexto } from './comprasReporteMensaje';
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
  y += 18;
  doc.setFont('helvetica', 'bold');
  doc.text('Impreso:', MARGEN_PDF, y);
  doc.setFont('helvetica', 'normal');
  doc.text(fechaReporteTexto(impresoIso), MARGEN_PDF + 52, y);
  y += 24;

  const wCant = 110;
  autoTable(doc, {
    startY: y,
    head: [['CONCEPTO', 'CANTIDAD']],
    body: r.items.map((i) => [i.titulo, String(i.cantidad)]),
    styles: { fontSize: 12, cellPadding: 9, valign: 'middle' },
    headStyles: { fillColor: [255, 224, 189], textColor: [138, 75, 0], fontStyle: 'bold', halign: 'center' },
    bodyStyles: { textColor: [20, 20, 20] },
    alternateRowStyles: { fillColor: [255, 246, 236] },
    tableWidth: CW,
    columnStyles: { 0: { cellWidth: CW - wCant }, 1: { halign: 'center', cellWidth: wCant, fontStyle: 'bold', fontSize: 15 } },
    margin: { ...MARGENES_TABLA_PDF },
  });

  doc.setFontSize(8); doc.setTextColor(120, 120, 120); doc.setFont('helvetica', 'normal');
  doc.text(`Impreso ${fechaReporteTexto(impresoIso)} · Órdenes de compra y servicios (no incluye compras ni servicios directos) · Mineral Group Guayana C.A.`, MARGEN_PDF, limiteInferiorPdf(H));

  previewPdfDoc(doc, 'cierre-diario-compras.pdf');
}
