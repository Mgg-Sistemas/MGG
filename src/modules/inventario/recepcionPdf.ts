/* ============================================================
   MGG · Inventario · COMPROBANTE DE RECEPCIÓN en PDF (04-11-2026)

   Mismo estilo que la ORDEN DE SALIDA: logo, título, datos del documento, la
   tabla de materiales con su precio y total, la nota y la firma de quien
   recibió. Solo por botón y en vista previa (en el teléfono, con «Abrir el PDF»).
   ============================================================ */
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import { textoPdf } from '@/shared/lib/textoPdf';
import { MARGEN_PDF, MARGENES_TABLA_PDF, limiteInferiorPdf } from '@/shared/lib/pdfMargen';
import { nombreAlmacenVisible } from './sectorizacion';
import { fechaHoraRecepcion, totalRecepcion, type DatosRecepcion } from './recepcionReporte';

const NARANJA: [number, number, number] = [255, 138, 0];
const num = (n: number) => (Number(n) || 0).toLocaleString('es-VE', { maximumFractionDigits: 4 });
const usd = (n: number) => `$ ${(Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function verRecepcionPdf(d: DatosRecepcion): Promise<void> {
  const [{ jsPDF }, { default: autoTable }, { loadLogoDataUrl }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('@/shared/lib/pdfLogo'),
  ]);
  const logo = await loadLogoDataUrl().catch(() => null);
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();

  let y = MARGEN_PDF;
  const LOGO = 62;
  if (logo) { try { doc.addImage(logo, 'JPEG', MARGEN_PDF, y, LOGO, LOGO); } catch { /* el logo es opcional */ } }
  const tx = logo ? MARGEN_PDF + LOGO + 16 : MARGEN_PDF;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(20);
  doc.text('COMPROBANTE DE RECEPCIÓN', tx, y + 26);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(60);
  doc.text(textoPdf(`N° ${d.codigo} · Emitido: ${fechaHoraRecepcion(new Date().toISOString())}`), tx, y + 46);
  y += LOGO + 12;
  doc.setDrawColor(...NARANJA); doc.setLineWidth(1.5);
  doc.line(MARGEN_PDF, y, W - MARGEN_PDF, y);
  y += 16;

  const pares: [string, string][] = [
    ['Orden', d.documento || d.codigo],
    ['Proveedor', d.proveedor || '—'],
    ['Almacén', d.almacen ? nombreAlmacenVisible(d.almacen) : '—'],
    ['Fecha de recepción', fechaHoraRecepcion(d.at) || '—'],
    ['Recibido por', d.quien || '—'],
    ...(d.delivery ? [['Delivery', d.delivery] as [string, string]] : []),
  ];
  autoTable(doc, {
    startY: y,
    body: pares.map(([k, v]) => [textoPdf(k), textoPdf(v)]),
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 2.5 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 140 } },
    margin: MARGENES_TABLA_PDF,
  });
  const fin = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  const total = totalRecepcion(d.items);
  autoTable(doc, {
    startY: fin() + 14,
    head: [['#', 'Material', 'Cantidad', 'Precio USD', 'Total USD']],
    body: d.items.map((it, i) => [
      String(i + 1), textoPdf(it.nombre),
      textoPdf(`${num(it.cantidad)}${it.unidad ? ` ${it.unidad}` : ''}${it.pedido != null && it.pedido > it.cantidad ? ` (de ${num(it.pedido)})` : ''}`),
      it.precio && it.precio > 0 ? usd(it.precio) : '—',
      it.precio && it.precio > 0 ? usd(it.precio * it.cantidad) : '—',
    ]),
    foot: total > 0 ? [['', '', '', 'TOTAL', usd(total)]] : undefined,
    theme: 'grid',
    headStyles: { fillColor: NARANJA, textColor: 255, fontStyle: 'bold', fontSize: 10 },
    footStyles: { fillColor: [242, 242, 242], textColor: 20, fontStyle: 'bold', fontSize: 10 },
    styles: { fontSize: 9.5, cellPadding: 4, overflow: 'linebreak' },
    columnStyles: { 0: { cellWidth: 26, halign: 'right' }, 2: { halign: 'right', cellWidth: 100 }, 3: { halign: 'right', cellWidth: 80 }, 4: { halign: 'right', cellWidth: 85 } },
    margin: MARGENES_TABLA_PDF,
  });

  let cy = fin() + 18;
  const obs = [d.nota?.trim() ? `Nota: ${d.nota.trim()}` : '', d.fotos ? `Fotos de la recepción: ${d.fotos}` : ''].filter(Boolean);
  if (obs.length) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('OBSERVACIONES / NOTAS', MARGEN_PDF, cy);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
    const t = doc.splitTextToSize(textoPdf(obs.join('\n')), W - MARGEN_PDF * 2);
    doc.text(t, MARGEN_PDF, cy + 14);
    cy += 14 + t.length * 12;
  }
  // Firma de quien recibió.
  const fy = Math.min(Math.max(cy + 60, H * 0.7), limiteInferiorPdf(H) - 30);
  const colW = 220;
  const cx = W / 2;
  doc.setDrawColor(120); doc.setLineWidth(0.7);
  doc.line(cx - colW / 2, fy, cx + colW / 2, fy);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.text('Recibido por', cx, fy + 13, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.text(textoPdf(d.quien || '—'), cx, fy + 26, { align: 'center' });

  doc.setFontSize(8); doc.setTextColor(120);
  doc.text('MINERAL GROUP GUAYANA C.A. · Sistema de Gestión de Inventarios', MARGEN_PDF, limiteInferiorPdf(H));
  previewPdfDoc(doc, `recepcion-${d.codigo.replace(/[^\w-]+/g, '_')}.pdf`);
}
