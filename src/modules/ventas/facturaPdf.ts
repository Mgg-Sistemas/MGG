/* ============================================================
   MGG · Ventas · Factura · PDF
   ============================================================ */
import type { Venta } from './ventas.repository';

const fmt = (v: number) => Number(v || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export async function descargarFacturaPdf(v: Venta): Promise<void> {
  const [{ dateTime }, { loadLogoDataUrl }, { jsPDF }, { default: autoTable }] = await Promise.all([
    import('@/shared/lib/format'), import('@/shared/lib/pdfLogo'), import('jspdf'), import('jspdf-autotable'),
  ]);
  const logo = await loadLogoDataUrl().catch(() => null);
  const m = v.moneda || 'USD';

  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  const PAGE_W = doc.internal.pageSize.getWidth();
  const MARGIN = 42.52;
  let y = MARGIN;

  if (logo) { try { doc.addImage(logo, 'JPEG', MARGIN, y, 46, 46); } catch { /* opcional */ } }
  const tx = logo ? MARGIN + 58 : MARGIN;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text('Mineral Group Guayana C.A.', tx, y + 16);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text('Factura de venta', tx, y + 32);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
  doc.text(v.numero, PAGE_W - MARGIN, y + 16, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(`Fecha: ${v.fecha}`, PAGE_W - MARGIN, y + 32, { align: 'right' });
  doc.text(`Estado: ${v.estado}`, PAGE_W - MARGIN, y + 44, { align: 'right' });
  y += 60;
  doc.setDrawColor(255, 138, 0); doc.setLineWidth(1.5); doc.line(MARGIN, y, PAGE_W - MARGIN, y); y += 16;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  doc.text('Cliente:', MARGIN, y);
  doc.setFont('helvetica', 'normal');
  doc.text(v.cliente_nombre || '—', MARGIN + 46, y); y += 16;
  if (v.vendedor) { doc.text(`Vendedor: ${v.vendedor}`, MARGIN, y); y += 14; }
  y += 4;

  autoTable(doc, {
    startY: y,
    head: [['Producto', 'Cant.', 'Tenor %', `Precio (${m})`, `Subtotal (${m})`]],
    body: (v.items ?? []).map((it) => [
      it.producto_nombre, fmt(it.cantidad), it.tenor_pct ? `${fmt(it.tenor_pct)}%` : '—',
      fmt(it.precio_unit), fmt(it.subtotal),
    ]),
    theme: 'striped',
    headStyles: { fillColor: [255, 138, 0], textColor: 20 },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
    styles: { fontSize: 9, cellPadding: 4 },
    margin: { left: MARGIN, right: MARGIN },
  });
  // @ts-expect-error lastAutoTable lo agrega el plugin
  y = doc.lastAutoTable.finalY + 14;

  const filas: [string, string][] = [
    ['Subtotal', `${m} ${fmt(v.subtotal)}`],
    ['Descuento', `- ${m} ${fmt(v.descuento)}`],
    [`IVA (${fmt(v.iva_pct)}%)`, `${m} ${fmt(v.iva_monto)}`],
    ['TOTAL', `${m} ${fmt(v.total)}`],
  ];
  autoTable(doc, {
    startY: y,
    body: filas,
    theme: 'plain',
    tableWidth: 240,
    margin: { left: PAGE_W - MARGIN - 240, right: MARGIN },
    styles: { fontSize: 10, cellPadding: 3 },
    columnStyles: { 0: { fontStyle: 'bold' }, 1: { halign: 'right' } },
    didParseCell: (d) => { if (d.row.index === 3) { d.cell.styles.fontStyle = 'bold'; d.cell.styles.fontSize = 12; } },
  });
  // @ts-expect-error lastAutoTable
  y = doc.lastAutoTable.finalY + 16;

  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(120);
  doc.text(`Generado: ${dateTime(new Date().toISOString())}`, MARGIN, y);
  if (v.nota) { y += 12; doc.text(`Nota: ${v.nota}`, MARGIN, y); }

  doc.save(`factura-${v.numero}.pdf`);
}
