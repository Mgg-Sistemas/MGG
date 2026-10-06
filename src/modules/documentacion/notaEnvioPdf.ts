/* ============================================================
   MGG · Documentación · Nota de envío (PDF · vista previa)

   Mismo contenido que el formato de papel («Nota de entrega»): N° y
   fecha, cliente / departamento, detalles de entrega, tabla ÍTEM ·
   DESCRIPCIÓN · CANT., total y las dos firmas A MANO (Entregado por /
   Recibido conforme). Con los colores y el encabezado de los PDF del
   sistema: logo + título + gris, naranja #FF8A00 en la línea, los
   títulos y la cabecera de la tabla. Carta, márgenes de 2 cm.
   Igual al PDF del módulo de Golden Touch.
   ============================================================ */
import { loadLogoDataUrl } from '@/shared/lib/pdfLogo';
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import { MARGEN_PDF } from '@/shared/lib/pdfMargen';
import { EMISOR_NOTA, cantidadTexto, numeroEnvio } from './notaEnvio';
import type { NotaEnvio } from './documentacion.repository';

/** Naranja del sistema (el de las cabeceras de tabla de todos los PDF). */
const NARANJA: [number, number, number] = [255, 138, 0];
const FONDO_CAJA: [number, number, number] = [255, 247, 237];
const BORDE_CAJA: [number, number, number] = [255, 200, 140];

function fechaVe(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split('-');
  return a && m && d ? `${d}/${m}/${a}` : iso;
}

export async function descargarNotaEnvioPdf(n: NotaEnvio): Promise<void> {
  const [{ jsPDF }, { default: autoTable }, logo] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    loadLogoDataUrl().catch(() => null),
  ]);
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = MARGEN_PDF;
  const der = W - M;
  let y = M;
  const anulada = n.estado === 'anulada';

  // ─── Encabezado del sistema: logo + título + gris; N° y fecha a la derecha ───
  const LOGO = 52;
  const tx = logo ? M + LOGO + 12 : M;
  if (logo) { try { doc.addImage(logo, 'JPEG', M, y, LOGO, LOGO); } catch { /* sin logo */ } }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(20);
  doc.text(anulada ? 'Nota de envío · ANULADA' : 'Nota de envío', tx, y + 17);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(120);
  doc.text(`${EMISOR_NOTA.razonSocial} · RIF ${EMISOR_NOTA.rif}`, tx, y + 32);
  doc.text('Envío de documentación', tx, y + 44);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(...NARANJA);
  doc.text(`N° ${numeroEnvio(n.numero)}`, der, y + 17, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(60);
  doc.text(`Fecha: ${fechaVe(n.fecha)}`, der, y + 33, { align: 'right' });
  y += Math.max(LOGO, 44) + 8;

  doc.setFontSize(8); doc.setTextColor(110);
  const dom = doc.splitTextToSize(`Domicilio fiscal: ${EMISOR_NOTA.domicilio}`, W - 2 * M) as string[];
  doc.text(dom, M, y);
  y += dom.length * 10 + 2;
  doc.setDrawColor(...NARANJA); doc.setLineWidth(1.5);
  doc.line(M, y, der, y);
  y += 14;

  // ─── Recuadros: cliente / departamento · detalles de entrega ───
  const gap = 12;
  const bw = (W - 2 * M - gap) / 2;
  const bh = 92;
  const caja = (x: number, titulo: string, filas: Array<[string, string]>) => {
    doc.setFillColor(...FONDO_CAJA); doc.setDrawColor(...BORDE_CAJA); doc.setLineWidth(0.7);
    doc.roundedRect(x, y, bw, bh, 5, 5, 'FD');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...NARANJA);
    doc.text(titulo, x + 10, y + 16);
    let fy = y + 34;
    filas.forEach(([k, v]) => {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90);
      doc.text(k, x + 10, fy);
      doc.setFont('helvetica', 'bold'); doc.setTextColor(20);
      const val = doc.splitTextToSize(v || '—', bw - 100) as string[];
      doc.text(val.slice(0, 2), x + 90, fy);
      fy += val.length > 1 ? 22 : 17;
    });
  };
  caja(M, 'DATOS DEL CLIENTE / DEPARTAMENTO', [['Razón social:', n.razon_social], ['RIF / C.I.:', n.rif ?? ''], ['Dirección:', n.direccion ?? '']]);
  caja(M + bw + gap, 'DETALLES DE ENTREGA', [['Atención a:', n.atencion_a ?? ''], ['Condición:', n.condicion ?? ''], ['Entregado por:', n.entregado_por === '—' ? '' : n.entregado_por]]);
  y += bh + 16;

  // ─── Renglones (tabla del sistema: cabecera naranja, cuadrícula gris) ───
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head: [['ÍTEM', 'DESCRIPCIÓN / CONCEPTO', 'CANT.']],
    body: n.items.map((r, i) => [String(i + 1).padStart(2, '0'), r.descripcion, cantidadTexto(r.cantidad)]),
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 9.5, cellPadding: 6, textColor: 20, lineColor: [210, 210, 210], lineWidth: 0.5 },
    headStyles: { fillColor: NARANJA, textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [250, 250, 250] },
    columnStyles: { 0: { cellWidth: 46, halign: 'center' }, 2: { cellWidth: 70, halign: 'right' } },
  });
  y = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y;
  y += 16;

  if (n.nota) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.setTextColor(70);
    const nl = doc.splitTextToSize(`Observaciones: ${n.nota}`, W - 2 * M) as string[];
    doc.text(nl, M, y + 4);
    y += nl.length * 12 + 8;
  }

  // ─── Total (abajo a la derecha, sobre las firmas) ───
  const firmaY = Math.max(y + 130, H - 120);
  const totalY = Math.max(y, firmaY - 110);
  const tw = 210, th = 40;
  doc.setFillColor(...FONDO_CAJA); doc.setDrawColor(...BORDE_CAJA); doc.setLineWidth(0.7);
  doc.roundedRect(der - tw, totalY, tw, th, 5, 5, 'FD');
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(40);
  doc.text(`Total ${n.total_etiqueta}:`, der - tw + 12, totalY + 25);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...NARANJA);
  doc.text(cantidadTexto(n.total_cantidad), der - 14, totalY + 25, { align: 'right' });

  // ─── Firmas (a mano: el sistema no estampa firma digital) ───
  const fw = (W - 2 * M - 40) / 2;
  doc.setDrawColor(120); doc.setLineWidth(0.6);
  doc.line(M, firmaY, M + fw, firmaY);
  doc.line(der - fw, firmaY, der, firmaY);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(20);
  const entregadoPor = n.entregado_por === '—' ? '' : n.entregado_por;
  doc.text(`Entregado por ${entregadoPor}`.trim(), M + fw / 2, firmaY + 15, { align: 'center', maxWidth: fw });
  doc.text('Recibido conforme', der - fw / 2, firmaY + 15, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90);
  doc.text('Firma', M + fw / 2, firmaY + 29, { align: 'center' });
  doc.text('Firma, sello, cédula y fecha', der - fw / 2, firmaY + 29, { align: 'center' });

  if (anulada) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(70); doc.setTextColor(220, 60, 60);
    doc.text('ANULADA', W / 2, H / 2, { align: 'center', angle: 30 });
  }

  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(150);
  doc.text(`Documento generado por el sistema · Nota de envío N° ${numeroEnvio(n.numero)}`, M, H - 30);

  previewPdfDoc(doc, `nota-envio-${numeroEnvio(n.numero)}.pdf`);
}
