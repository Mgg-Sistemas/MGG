/* ============================================================
   MGG · Documentación · PDF de la nota de envío

   Hoja carta, igual al papel que ya usan: encabezado de la empresa a la
   izquierda y «NOTA DE ENVÍO» con N° y fecha a la derecha; dos recuadros
   (datos del destinatario / detalles de entrega); tabla ITEM · DESCRIPCIÓN ·
   CANTD.; recuadro «Total documentos»; y abajo dos líneas de firma A MANO:
   «Entregado por …» y «Recibido conforme (firma, sello, cédula y fecha)».
   ============================================================ */
import { date } from '@/shared/lib/format';
import { loadLogoDataUrl } from '@/shared/lib/pdfLogo';
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import { MARGEN_PDF } from '@/shared/lib/pdfMargen';
import { EMISOR_NOTA } from './notaEnvio';
import type { NotaEnvio } from './documentacion.repository';

const NARANJA: [number, number, number] = [194, 95, 60];
const GRIS: [number, number, number] = [120, 120, 120];

export async function notaEnvioPdf(n: NotaEnvio): Promise<void> {
  const [{ jsPDF }, autoTableMod, logo] = await Promise.all([
    import('jspdf'), import('jspdf-autotable'), loadLogoDataUrl().catch(() => null),
  ]);
  const autoTable = autoTableMod.default;
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = MARGEN_PDF;
  let y = M;

  // Encabezado: empresa a la izquierda, título + N° + fecha a la derecha.
  if (logo) { try { doc.addImage(logo, 'JPEG', M, y - 6, 44, 44); } catch { /* sin logo */ } }
  const tx = logo ? M + 52 : M;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(0);
  doc.text(EMISOR_NOTA.razonSocial, tx, y + 10);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  doc.text(`RIF: ${EMISOR_NOTA.rif}`, tx, y + 24);
  const dom = doc.splitTextToSize(`Domicilio Fiscal: ${EMISOR_NOTA.domicilio}`, W / 2 + 20 - tx) as string[];
  dom.forEach((t, i) => doc.text(t, tx, y + 36 + i * 11));

  const bx = W - M - 180;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...NARANJA);
  doc.text('NOTA DE ENVÍO', W - M, y + 10, { align: 'right' });
  doc.setTextColor(0); doc.setFontSize(9);
  doc.text('N°:', bx, y + 30); doc.text('Fecha:', bx, y + 46);
  doc.setFont('helvetica', 'normal');
  doc.setDrawColor(170); doc.setLineWidth(0.5); doc.setLineDashPattern([2, 2], 0);
  doc.rect(bx + 40, y + 20, 140, 15); doc.rect(bx + 40, y + 36, 140, 15);
  doc.setLineDashPattern([], 0);
  doc.setFont('helvetica', 'bold');
  doc.text(n.codigo, bx + 174, y + 31, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.text(date(n.fecha), bx + 174, y + 47, { align: 'right' });
  if (n.estado === 'anulada') {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(220, 38, 38);
    doc.text('ANULADA', W - M, y + 64, { align: 'right' });
    doc.setTextColor(0);
  }
  y += Math.max(60, 36 + dom.length * 11) + 8;
  doc.setDrawColor(...NARANJA); doc.setLineWidth(1.2); doc.line(M, y, W - M, y);
  y += 16;

  // Dos recuadros: destinatario / detalles de entrega.
  const gap = 14; const cw = (W - 2 * M - gap) / 2; const ch = 92;
  const recuadro = (x: number, titulo: string, filas: Array<[string, string]>) => {
    doc.setDrawColor(200); doc.setLineWidth(0.6); doc.roundedRect(x, y, cw, ch, 4, 4);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...NARANJA);
    doc.text(titulo, x + 10, y + 15);
    doc.setTextColor(0); doc.setFontSize(8.5);
    let fy = y + 32;
    for (const [k, v] of filas) {
      doc.setFont('helvetica', 'bold'); doc.text(k, x + 10, fy);
      doc.setFont('helvetica', 'normal');
      const lineas = doc.splitTextToSize(v || '—', cw - 100) as string[];
      lineas.slice(0, 2).forEach((t, i) => doc.text(t, x + 92, fy + i * 10));
      fy += Math.max(1, Math.min(2, lineas.length)) * 10 + 4;
    }
  };
  recuadro(M, 'DATOS DEL DESTINATARIO / DEPARTAMENTO', [
    ['Razón Social:', n.razon_social],
    ['RIF / C.I.:', n.rif ?? ''],
    ['Dirección:', n.direccion ?? ''],
  ]);
  recuadro(M + cw + gap, 'DETALLES DE ENTREGA', [
    ['Atención a:', n.atencion_a ?? ''],
    ['Condición:', n.condicion ?? ''],
    ['Entregado por:', n.entregado_por],
  ]);
  y += ch + 16;

  // Renglones.
  autoTable(doc, {
    startY: y,
    head: [['ITEM', 'DESCRIPCIÓN / CONCEPTO', 'CANTD.']],
    body: n.items.map((it, i) => [String(i + 1).padStart(2, '0'), it.descripcion, String(it.cantidad)]),
    theme: 'striped',
    headStyles: { fillColor: NARANJA, textColor: 255, fontStyle: 'bold', fontSize: 9 },
    styles: { fontSize: 9, cellPadding: 5 },
    columnStyles: { 0: { cellWidth: 44, halign: 'center' }, 2: { cellWidth: 70, halign: 'right' } },
    margin: { left: M, right: M },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14;

  // Total.
  const tw = 220; const tx2 = W - M - tw;
  doc.setDrawColor(200); doc.roundedRect(tx2, y, tw, 34, 4, 4);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  doc.text('Total documentos:', tx2 + 12, y + 21);
  doc.setLineDashPattern([2, 2], 0); doc.setDrawColor(170);
  doc.rect(tx2 + 120, y + 8, 88, 18); doc.setLineDashPattern([], 0);
  doc.text(String(n.total_cantidad), tx2 + 202, y + 21, { align: 'right' });
  y += 48;

  if (n.nota) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...GRIS);
    const obs = doc.splitTextToSize(`Observación: ${n.nota}`, W - 2 * M) as string[];
    obs.forEach((t, i) => doc.text(t, M, y + i * 10));
    doc.setTextColor(0);
    y += obs.length * 10 + 8;
  }

  // Firmas a mano: líneas vacías, abajo de la hoja.
  const fy = Math.max(y + 110, H - M - 60);
  const lw = (W - 2 * M - 60) / 2;
  doc.setDrawColor(0); doc.setLineWidth(0.8);
  doc.line(M, fy, M + lw, fy);
  doc.line(W - M - lw, fy, W - M, fy);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.text(`Entregado por: ${n.entregado_por}`, M + lw / 2, fy + 13, { align: 'center' });
  doc.text('Recibido conforme', W - M - lw / 2, fy + 13, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GRIS);
  doc.text('Firma', M + lw / 2, fy + 25, { align: 'center' });
  doc.text('Firma, sello, cédula y fecha', W - M - lw / 2, fy + 25, { align: 'center' });
  doc.setTextColor(0);

  previewPdfDoc(doc, `${n.codigo}-nota-de-envio.pdf`);
}
