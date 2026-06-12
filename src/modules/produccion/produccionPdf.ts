/* ============================================================
   MGG · Fundición · Reporte PDF
   Genera el PDF del proceso de fundición (materiales, costos,
   PMP y posible ganancia). Devuelve base64 para enviarlo por correo.
   ============================================================ */
import type { Produccion } from '@/shared/lib/types';
import { getProduccionConMateriales } from './produccion.repository';

async function construir(prod: Produccion) {
  const [{ jsPDF }, { default: autoTable }, { dateTime, money, num }, { loadLogoDataUrl }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('@/shared/lib/format'),
    import('@/shared/lib/pdfLogo'),
  ]);
  const logo = await loadLogoDataUrl().catch(() => null);

  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const MARGIN = 42.52; // 1,5 cm (margen uniforme en todos los lados)
  let y = MARGIN;
  if (logo) { try { doc.addImage(logo, 'JPEG', MARGIN, y, 46, 46); } catch { /* opcional */ } }
  const tx = logo ? MARGIN + 60 : MARGIN;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text('Reporte de Fundición', tx, y + 18);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(`MGG · ${dateTime(new Date().toISOString())}`, tx, y + 33);
  y += 60;

  doc.setFontSize(11); doc.setFont('helvetica', 'bold');
  doc.text(`${prod.producto_nombre} · ${num(prod.cantidad)} und`, MARGIN, y); y += 16;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  const dur = duracion(prod.inicio_at, prod.fin_at);
  const ficha: Array<[string, string]> = [
    ['Receta N°', prod.receta_num != null ? `#${num(prod.receta_num)}` : '—'],
    ['Estado', prod.estado === 'finalizado' ? 'Finalizado' : 'En fundición'],
    ['Almacén destino', prod.almacen_destino],
    ['Horno utilizado', prod.horno || '—'],
    ['Inicio', dateTime(prod.inicio_at)],
    ['Fin', prod.fin_at ? dateTime(prod.fin_at) : '—'],
    ['Duración', dur],
  ];
  autoTable(doc, {
    startY: y,
    body: ficha,
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 130 } },
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  });
  // @ts-expect-error lastAutoTable lo agrega el plugin
  y = (doc.lastAutoTable?.finalY ?? y) + 14;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  doc.text('Materiales utilizados', MARGIN, y); y += 6;
  autoTable(doc, {
    startY: y,
    head: [['Material', 'Almacén', 'Cantidad', 'Costo unit.', 'Subtotal']],
    body: (prod.materiales ?? []).map((m) => [m.material_nombre, m.almacen, num(m.cantidad), money(m.costo_unitario), money(m.subtotal)]),
    theme: 'grid',
    headStyles: { fillColor: [255, 138, 0], textColor: 255, fontSize: 8 },
    styles: { fontSize: 8, cellPadding: 3 },
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  });
  // @ts-expect-error lastAutoTable
  y = (doc.lastAutoTable?.finalY ?? y) + 14;

  const resumen: Array<[string, string]> = [
    ['Costo Total de Materiales (CTM)', money(prod.costo_material)],
    ['Mano de obra', money(prod.mano_obra)],
    ['Costos indirectos', money(prod.costos_indirectos)],
    ['Costo de Fundición (CP)', money(prod.costo_material + prod.mano_obra + prod.costos_indirectos)],
    ['Costo unitario (PMP)', money(prod.costo_unitario)],
    ['Precio de venta', prod.precio_venta != null ? money(prod.precio_venta) : '—'],
    ['Posible ganancia', prod.ganancia != null ? money(prod.ganancia) : '—'],
  ];
  autoTable(doc, {
    startY: y,
    body: resumen,
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 220 } },
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  });

  return { doc, filename: `produccion-${prod.producto_nombre}-${prod.id.slice(0, 8)}.pdf` };
}

function duracion(inicio: string, fin?: string | null): string {
  if (!fin) return 'En curso';
  const ms = new Date(fin).getTime() - new Date(inicio).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const min = Math.floor(ms / 60000);
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

export async function descargarProduccionPdf(id: string): Promise<void> {
  const prod = await getProduccionConMateriales(id);
  if (!prod) throw new Error('Fundición no encontrada');
  const { doc, filename } = await construir(prod);
  doc.save(filename);
}

export async function obtenerProduccionPdfBase64(id: string): Promise<{ base64: string; filename: string }> {
  const prod = await getProduccionConMateriales(id);
  if (!prod) throw new Error('Fundición no encontrada');
  const { doc, filename } = await construir(prod);
  const dataUri = doc.output('datauristring');
  const base64 = dataUri.split(',')[1] ?? '';
  return { base64, filename };
}
