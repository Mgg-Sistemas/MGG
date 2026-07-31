/* ============================================================
   MGG · Pedidos · COMPROBANTE DE PAGO de una OC (vista previa)
   Voucher de una página con los datos del pago de la Orden de Compra:
   proveedor, monto, método(s) de pago, seriales, fecha y quién pagó.
   Se genera desde los datos de la propia orden (no necesita el
   movimiento de Tesorería) y se abre en VISTA PREVIA (previewPdfDoc),
   disponible desde que la OC está PAGADA y en el histórico finalizada.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { dateTime, money } from '@/shared/lib/format';
import { loadLogoDataUrl } from '@/shared/lib/pdfLogo';
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import { cargarPersonasPorEmail, personaDe } from '@/shared/lib/personas';
import { labelMetodoPago } from './pedidos.repository';
import { labelCondicionPago } from './ofertas.repository';
import type { Orden, Proveedor } from '@/shared/lib/types';

const ORANGE: [number, number, number] = [255, 138, 0];

/** Arma el documento del comprobante de pago de la OC. */
async function construir(orden: Orden, proveedor: Proveedor | null) {
  const [logo, { jsPDF }, { default: autoTable }, personas] = await Promise.all([
    loadLogoDataUrl().catch(() => null),
    import('jspdf'),
    import('jspdf-autotable'),
    cargarPersonasPorEmail().catch(() => new Map<string, string>()),
  ]);

  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const PAGE_W = doc.internal.pageSize.getWidth();
  const MARGIN = 42.52;
  let y = MARGIN;

  const LOGO = 60;
  const TEXT_X = logo ? MARGIN + LOGO + 14 : MARGIN;
  if (logo) { try { doc.addImage(logo, 'JPEG', MARGIN, y, LOGO, LOGO); } catch { /* logo opcional */ } }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20);
  doc.text('COMPROBANTE DE PAGO', TEXT_X, y + 20);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text(`${orden.oc_codigo ?? orden.codigo} · ${orden.pagada_en ? dateTime(orden.pagada_en) : 'sin fecha de pago'}`, TEXT_X, y + 38);
  doc.text(`Generado: ${dateTime(new Date().toISOString())}`, PAGE_W - MARGIN, y + 38, { align: 'right' });
  y += Math.max(LOGO, 42) + 8;

  doc.setDrawColor(...ORANGE); doc.setLineWidth(1.5);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y); y += 12;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text('Mineral Group Guayana C.A. · RIF J-50221930-7 · Sistema de Gestión de Inventarios', MARGIN, y); y += 6;

  const moneda = orden.moneda || 'USD';
  const total = Number(orden.total) || 0;
  const desc = Number(orden.descuento_pago) || 0;
  const aPagar = total - desc;

  // ── Orden ──
  const filasOrden: Array<[string, string]> = [
    ['OP', orden.codigo],
    ['N° ODC', orden.oc_codigo ?? '—'],
    ['Proveedor', proveedor?.nombre ?? '—'],
    ['Solicitante', orden.ci_solicitante || orden.solicitante || personaDe(orden.solicitante_email, personas, null)],
  ];
  if (orden.condiciones_pago) filasOrden.push(['Condición de pago', labelCondicionPago(orden.condiciones_pago)]);
  autoTable(doc, {
    startY: y + 6,
    head: [['Orden de compra', '']],
    body: filasOrden,
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    styles: { fontSize: 9, cellPadding: 4, overflow: 'linebreak' },
    headStyles: { fillColor: ORANGE, textColor: 255, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 150, fontStyle: 'bold' }, 1: { cellWidth: 'auto' } },
  });

  // ── Pago ──
  const metodos = orden.metodo_pago ?? [];
  const filasPago: Array<[string, string]> = [['Total OC', money(total, moneda)]];
  if (desc > 0) { filasPago.push(['Descuento al pagar', `− ${money(desc, moneda)}`]); filasPago.push(['Monto pagado', money(aPagar, moneda)]); }
  if (metodos.length) {
    metodos.forEach((m, i) => filasPago.push([metodos.length > 1 ? `Método de pago ${i + 1}` : 'Método de pago', `${labelMetodoPago(m.metodo)} · ${money(Number(m.monto) || 0, m.moneda || moneda)}`]));
  }
  const seriales = orden.seriales_billetes ?? [];
  if (seriales.length) filasPago.push(['Seriales de billetes', seriales.join('  ·  ')]);
  if (orden.pagada_en) filasPago.push(['Fecha de pago', dateTime(orden.pagada_en)]);
  filasPago.push(['Pagado por', personaDe(orden.pagada_por, personas, null)]);
  filasPago.push(['Comprobante adjunto', orden.factura_path ? (orden.factura_nombre || 'Adjunto') : 'No se subió (efectivo, opcional)']);

  // @ts-expect-error lastAutoTable lo agrega el plugin en runtime
  const afterY = (doc.lastAutoTable?.finalY ?? y) + 18;
  autoTable(doc, {
    startY: afterY,
    head: [['Pago', '']],
    body: filasPago,
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    styles: { fontSize: 9, cellPadding: 4, overflow: 'linebreak' },
    headStyles: { fillColor: ORANGE, textColor: 255, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 150, fontStyle: 'bold' }, 1: { cellWidth: 'auto' } },
  });

  return doc;
}

/** Genera el COMPROBANTE DE PAGO de una OC (por id) y lo abre en vista previa. */
export async function descargarComprobantePagoPdf(ordenId: string): Promise<void> {
  const { data: orden, error } = await supabase.from('ordenes').select('*').eq('id', ordenId).single();
  if (error || !orden) throw error ?? new Error('Orden no encontrada');
  const o = orden as Orden;
  let proveedor: Proveedor | null = null;
  if (o.proveedor_id) {
    const { data: prov } = await supabase.from('proveedores').select('*').eq('id', o.proveedor_id).maybeSingle();
    proveedor = (prov ?? null) as Proveedor | null;
  }
  const doc = await construir(o, proveedor);
  const ref = (o.oc_codigo || o.codigo || ordenId.slice(0, 8)).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/(^-|-$)/g, '');
  previewPdfDoc(doc, `comprobante-pago-${ref}.pdf`);
}
