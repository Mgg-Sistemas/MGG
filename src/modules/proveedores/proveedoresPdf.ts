/* ============================================================
   MGG · Proveedores · PDF · 21-10-2026
   Hoja horizontal: logo, título, filtros aplicados, resumen, fecha y hora, y una tabla con
   RIF, razón social, contacto y teléfonos, email, actividad, categorías y estado.
   Mismos estilos que el resto de los reportes (logo, margen de 2 cm, pie con paginado).
   Se MUESTRA en vista previa: nada se descarga solo.
   ============================================================ */
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import { MARGEN_PDF, MARGENES_TABLA_PDF, anchoUtilPdf, limiteInferiorPdf } from '@/shared/lib/pdfMargen';
import { fechaReporteTexto } from '@/modules/pedidos/comprasReporteMensaje';
import { resumenProveedores, type FilaProveedor } from './proveedoresReporte';

export async function descargarProveedoresPdf(filas: FilaProveedor[], filtros: string, impresoIso: string = new Date().toISOString()): Promise<void> {
  const [{ jsPDF }, { default: autoTable }, { loadLogoDataUrl }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('@/shared/lib/pdfLogo'),
  ]);
  const logo = await loadLogoDataUrl().catch(() => null);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const CW = anchoUtilPdf(W);
  let y = MARGEN_PDF;

  if (logo) { try { doc.addImage(logo, 'JPEG', MARGEN_PDF, y, 44, 44); } catch { /* opcional */ } }
  doc.setTextColor(255, 138, 0); doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text('PROVEEDORES', W / 2 + 28, y + 20, { align: 'center' });
  doc.setTextColor(120, 120, 120); doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
  doc.text('Mineral Group Guayana C.A.', W / 2 + 28, y + 36, { align: 'center' });
  doc.setTextColor(0, 0, 0);
  y += 62;

  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'bold'); doc.text('Filtros:', MARGEN_PDF, y);
  doc.setFont('helvetica', 'normal'); doc.text(filtros, MARGEN_PDF + 38, y);
  y += 14;
  doc.setFont('helvetica', 'bold'); doc.text('Total:', MARGEN_PDF, y);
  doc.setFont('helvetica', 'normal'); doc.text(`${resumenProveedores(filas)} · Impreso: ${fechaReporteTexto(impresoIso)}`, MARGEN_PDF + 38, y);
  y += 10;

  const col = (pct: number) => Math.round(CW * pct);
  autoTable(doc, {
    startY: y + 4,
    head: [['RIF', 'RAZÓN SOCIAL', 'CONTACTO / TELÉFONO', 'EMAIL', 'ACTIVIDAD ECONÓMICA', 'CATEGORÍAS', 'ESTADO']],
    body: filas.map((f) => [
      f.rif,
      f.razonSocial,
      [f.contacto, f.telefono && `Tel. ${f.telefono}`, f.telefonoAdmin && `Admin. ${f.telefonoAdmin}`].filter(Boolean).join('\n') || '—',
      f.email || '—',
      f.actividad || '—',
      f.categorias || '—',
      f.estado,
    ]),
    styles: { fontSize: 8, cellPadding: 4, valign: 'top', overflow: 'linebreak' },
    headStyles: { fillColor: [255, 224, 189], textColor: [138, 75, 0], fontStyle: 'bold', halign: 'center', fontSize: 8 },
    bodyStyles: { textColor: [20, 20, 20] },
    alternateRowStyles: { fillColor: [255, 246, 236] },
    tableWidth: CW,
    columnStyles: {
      0: { cellWidth: col(0.10) },
      1: { cellWidth: col(0.20), fontStyle: 'bold' },
      2: { cellWidth: col(0.17) },
      3: { cellWidth: col(0.16) },
      4: { cellWidth: col(0.17) },
      5: { cellWidth: col(0.12) },
      6: { cellWidth: CW - col(0.10) - col(0.20) - col(0.17) - col(0.16) - col(0.17) - col(0.12), halign: 'center' },
    },
    margin: { ...MARGENES_TABLA_PDF },
    didDrawPage: () => {
      doc.setFontSize(8); doc.setTextColor(120, 120, 120); doc.setFont('helvetica', 'normal');
      doc.text(`Impreso ${fechaReporteTexto(impresoIso)} · Mineral Group Guayana C.A.`, MARGEN_PDF, limiteInferiorPdf(H));
      doc.text(`Pág. ${doc.getNumberOfPages()}`, W - MARGEN_PDF, limiteInferiorPdf(H), { align: 'right' });
    },
  });

  previewPdfDoc(doc, 'proveedores-mgg.pdf');
}
