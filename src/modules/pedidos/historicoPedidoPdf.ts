/* ============================================================
   MGG · Histórico · Detalle de un Pedido / Compra en PDF (vista previa)
   Sirve para cualquier estado (OP pendiente → OC finalizada): cabecera
   con los datos del pedido, items con cantidades/precios, notas e
   historial. Solo por botón, con vista previa.
   ============================================================ */
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import type { Orden } from '@/shared/lib/types';

function money(n: number | null | undefined): string {
  return `$ ${Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function num(n: number | null | undefined): string {
  return Number(n || 0).toLocaleString('es-VE', { maximumFractionDigits: 2 });
}

export async function descargarDetallePedidoPdf(orden: Orden, proveedorNombre?: string | null): Promise<void> {
  const [{ jsPDF }, { default: autoTable }, fmt, { loadLogoDataUrl }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('@/shared/lib/format'),
    import('@/shared/lib/pdfLogo'),
  ]);
  const logo = await loadLogoDataUrl().catch(() => null);
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const MARGIN = 42.52;
  let y = MARGIN;

  const LOGO = 56;
  const TX = logo ? MARGIN + LOGO + 14 : MARGIN;
  if (logo) { try { doc.addImage(logo, 'JPEG', MARGIN, y, LOGO, LOGO); } catch { /* opcional */ } }

  doc.setTextColor(255, 138, 0); doc.setFont('helvetica', 'bold'); doc.setFontSize(17);
  doc.text('DETALLE DE PEDIDO / COMPRA', TX, y + 20);
  doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text(`N° OP ${orden.codigo}${orden.oc_codigo ? `  ·  N° OC ${orden.oc_codigo}` : ''}`, TX, y + 38);
  y += LOGO + 14;

  // Cabecera de datos (dos columnas de key/value).
  const estadoLabel = fmt.statusBadge(orden.estado).label;
  const filas: Array<[string, string]> = [
    ['Estado', estadoLabel],
    ['Solicitante', orden.solicitante ?? orden.solicitante_email ?? '—'],
    ['Proveedor', proveedorNombre || '—'],
    ['Clasificación', (orden.clasificacion ?? []).join(', ') || '—'],
    ['Condición de pago', orden.condiciones_pago ?? '—'],
    ['Almacén destino', orden.almacen_destino ?? '—'],
    ['Fecha solicitud', orden.created_at ? fmt.dateTime(orden.created_at) : '—'],
    ['Aprobada', orden.aprobada_en ? fmt.dateTime(orden.aprobada_en) : '—'],
    ['OC emitida', orden.oc_emitida_en ? fmt.dateTime(orden.oc_emitida_en) : '—'],
    ['Finalizada', orden.finalizada_en ? fmt.dateTime(orden.finalizada_en) : '—'],
  ];
  autoTable(doc, {
    startY: y,
    body: filas.map(([k, v]) => [k, v]),
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: { 0: { cellWidth: 120, fontStyle: 'bold', textColor: [90, 90, 90] }, 1: { cellWidth: W - MARGIN * 2 - 120 } },
    margin: { left: MARGIN, right: MARGIN },
  });
  // @ts-expect-error lastAutoTable lo agrega el plugin
  y = (doc.lastAutoTable?.finalY ?? y) + 12;

  // Items del pedido.
  const items = orden.items ?? [];
  const body = items.map((it, i) => [
    String(i + 1),
    it.sku ?? '—',
    it.nombre ?? '—',
    `${num(it.cantidad)}${it.unidad ? ` ${it.unidad}` : ''}`,
    money(it.precio),
    money((Number(it.cantidad) || 0) * (Number(it.precio) || 0)),
  ]);
  autoTable(doc, {
    startY: y,
    head: [['#', 'SKU', 'PRODUCTO', 'CANTIDAD', 'PRECIO', 'SUBTOTAL']],
    body: body.length ? body : [['—', '—', 'Sin items', '—', '—', '—']],
    foot: [['', '', '', '', 'TOTAL', money(orden.total)]],
    styles: { fontSize: 8.5, cellPadding: 3.5, valign: 'middle', overflow: 'linebreak' },
    headStyles: { fillColor: [210, 210, 210], textColor: [20, 20, 20], fontStyle: 'bold', halign: 'center' },
    footStyles: { fillColor: [255, 138, 0], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'right' },
    columnStyles: {
      0: { halign: 'center', cellWidth: 26 },
      1: { cellWidth: 90 },
      2: { cellWidth: W - MARGIN * 2 - 26 - 90 - 80 - 75 - 80 },
      3: { halign: 'right', cellWidth: 80 },
      4: { halign: 'right', cellWidth: 75 },
      5: { halign: 'right', cellWidth: 80 },
    },
    margin: { left: MARGIN, right: MARGIN },
  });
  // @ts-expect-error lastAutoTable lo agrega el plugin
  y = (doc.lastAutoTable?.finalY ?? y) + 14;

  const motivo = (orden.motivo ?? orden.finalidad ?? '').trim();
  const notas = (orden.notas ?? '').trim();
  const PAGE_H = doc.internal.pageSize.getHeight();
  function bloqueTexto(titulo: string, texto: string) {
    if (!texto) return;
    if (y > PAGE_H - MARGIN - 50) { doc.addPage(); y = MARGIN; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(90, 90, 90);
    doc.text(titulo, MARGIN, y); y += 13;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(0, 0, 0);
    const lines = doc.splitTextToSize(texto, W - MARGIN * 2);
    doc.text(lines, MARGIN, y); y += lines.length * 12 + 8;
  }
  bloqueTexto('Motivo / finalidad', motivo);
  bloqueTexto('Notas', notas);

  doc.setFontSize(8); doc.setTextColor(120, 120, 120);
  doc.text(`Generado ${fmt.dateTime(new Date().toISOString())} · Mineral Group Guayana C.A.`, MARGIN, PAGE_H - 16);

  previewPdfDoc(doc, `pedido-${orden.codigo}.pdf`);
}
