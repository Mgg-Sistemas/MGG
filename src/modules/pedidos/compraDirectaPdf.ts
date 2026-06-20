/* ============================================================
   MGG · Compra Directa · Comprobante PDF
   Se descarga SOLO al hacer clic (regla del sistema).
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

  const cant = Number(compra.cantidad) || 0;
  const gasto = compra.gasto != null ? Number(compra.gasto) : null;
  const costoUnit = gasto != null && cant > 0 ? gasto / cant : null;

  const ficha: Array<[string, string]> = [
    ...(compra.codigo ? [['Código', compra.codigo] as [string, string]] : []),
    ['Material', compra.producto_sku ? `${compra.producto_sku} — ${compra.producto_nombre}` : compra.producto_nombre],
    ['Almacén destino', compra.almacen || '—'],
    ['Cantidad', fmt.num(cant)],
    ['Estado', compra.estado === 'finalizada' ? 'Finalizada (ingresó a inventario)' : 'En proceso'],
    ['Gasto', gasto != null ? fmt.money(gasto) : '—'],
    ['Costo unitario', costoUnit != null ? fmt.money(costoUnit) : '—'],
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
  previewPdfDoc(doc, `compra-directa-${(compra.producto_sku ?? 'material')}-${compra.id.slice(0, 8)}.pdf`);
}
