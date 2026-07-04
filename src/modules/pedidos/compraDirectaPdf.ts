/* ============================================================
   MGG · Compra Directa · Comprobante PDF
   Se abre en VISTA PREVIA SOLO al hacer clic (regla del sistema).
   Muestra TODOS los materiales con cantidad y precio.
   ============================================================ */
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import { cargarPersonasPorEmail, personaDe } from '@/shared/lib/personas';
import type { CompraDirecta } from './compras.repository';

export async function descargarCompraDirectaPdf(compra: CompraDirecta): Promise<void> {
  const [{ jsPDF }, { default: autoTable }, fmt, { loadLogoDataUrl }, personas] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('@/shared/lib/format'),
    import('@/shared/lib/pdfLogo'),
    cargarPersonasPorEmail().catch(() => new Map<string, string>()),
  ]);
  const logo = await loadLogoDataUrl().catch(() => null);
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const MARGIN = 42.52; // 1,5 cm (margen uniforme en todos los lados)
  let y = MARGIN;
  if (logo) { try { doc.addImage(logo, 'JPEG', MARGIN, y, 46, 46); } catch { /* opcional */ } }
  const tx = logo ? MARGIN + 60 : MARGIN;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text('Comprobante de Compra Directa', tx, y + 18);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(`MGG · ${fmt.dateTime(new Date().toISOString())}`, tx, y + 33);
  y += 60;

  // Ítems: si la fila vieja no trae items[], se arma uno con el producto suelto.
  const items = compra.items?.length
    ? compra.items
    : [{ producto_id: compra.producto_id ?? '', producto_nombre: compra.producto_nombre, producto_sku: compra.producto_sku, cantidad: Number(compra.cantidad) || 0, gasto: compra.gasto }];
  const totalGasto = compra.gasto != null ? Number(compra.gasto) : items.reduce((a, it) => a + (Number(it.gasto) || 0), 0);

  const ficha: Array<[string, string]> = [
    ...(compra.codigo ? [['Código', compra.codigo] as [string, string]] : []),
    ['Almacén destino', compra.almacen || '—'],
    ['Proveedor', compra.proveedor_nombre || '—'],
    ['Estado', compra.estado === 'finalizada' ? 'Finalizada (ingresó a inventario)' : 'En proceso'],
    ['Gasto total', totalGasto > 0 ? fmt.money(totalGasto) : '—'],
    ...(compra.pago_externo ? [['Pago a externo', 'Sí — reintegrar a la persona externa'] as [string, string]] : []),
    ['Generó', personaDe(compra.actor, personas, compra.actor_name)],
    ['Fecha de creación', fmt.dateTime(compra.created_at)],
    ['Fecha de compra', compra.finalizada_at ? fmt.dateTime(compra.finalizada_at) : '—'],
    ['Adjunto', compra.adjunto_nombre || '—'],
  ];
  autoTable(doc, {
    startY: y, body: ficha, theme: 'plain',
    styles: { fontSize: 10, cellPadding: 3 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 160 } },
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14;

  // Detalle de materiales: cantidad, costo unitario y precio (gasto) de cada renglón.
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text('Materiales comprados', MARGIN, y);
  y += 6;
  autoTable(doc, {
    startY: y,
    head: [['SKU', 'Material', 'Cantidad', 'Costo unit.', 'Precio']],
    body: items.map((it) => {
      const cant = Number(it.cantidad) || 0;
      const g = it.gasto != null ? Number(it.gasto) : null;
      const cu = g != null && cant > 0 ? g / cant : null;
      return [
        it.producto_sku || '—',
        it.producto_nombre,
        fmt.num(cant),
        cu != null ? fmt.money(cu) : '—',
        g != null ? fmt.money(g) : '—',
      ];
    }),
    foot: [['', '', '', 'TOTAL', totalGasto > 0 ? fmt.money(totalGasto) : '—']],
    theme: 'grid',
    headStyles: { fillColor: [255, 138, 0], textColor: 255 },
    footStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: 'bold' },
    styles: { fontSize: 9, cellPadding: 4 },
    columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  });

  const pageW = doc.internal.pageSize.getWidth();
  let blockY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  // Bloque de texto con título (reintegro / nota). Avanza el cursor `blockY`.
  const bloqueTexto = (titulo: string, texto: string) => {
    blockY += 18;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text(titulo, MARGIN, blockY);
    blockY += 14;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    const lineas = doc.splitTextToSize(texto, pageW - MARGIN * 2) as string[];
    doc.text(lineas, MARGIN, blockY);
    blockY += lineas.length * 12;
  };

  // Pago a externo (si aplica): lo pagó una persona externa y MGG debe reintegrarle.
  if (compra.pago_externo) {
    bloqueTexto('Pago a externo — reintegrar el dinero',
      compra.pago_externo_datos?.trim() || 'Lo pagó una persona externa; Tesorería le reintegra al pagar.');
  }

  // Nota para Tesorería (si la cargó el analista).
  if (compra.nota?.trim()) bloqueTexto('Nota para Tesorería', compra.nota.trim());

  previewPdfDoc(doc, `compra-directa-${(compra.codigo ?? compra.id.slice(0, 8))}.pdf`);
}
