/* ============================================================
   MGG · Tesorería · PDF del detalle de UN movimiento
   Documento de una sola página con todos los datos del movimiento
   (fechas, montos, saldos, quién lo registró) y, si es un pago de
   compra, la orden pagada, los seriales de los billetes y el
   comprobante (nombre del archivo). Reusa la estética del reporte
   (logo + franja naranja). Sirve para descargar o enviar por correo.
   ============================================================ */
import { dateTime } from '@/shared/lib/format';
import { loadLogoDataUrl } from '@/shared/lib/pdfLogo';
import { labelCondicionPago } from '@/modules/pedidos/ofertas.repository';
import type { MovimientoCaja, Orden } from '@/shared/lib/types';

const TIPO_LABEL: Record<string, string> = {
  ingreso: 'Ingreso', salida: 'Egreso', traslado_salida: 'Traslado (sale)',
  traslado_entrada: 'Traslado (entra)', ajuste: 'Ajuste',
};
const CAT_LABEL: Record<string, string> = {
  gasto: 'Gasto', pago_personal: 'Pago a personal', pago_oc: 'Pago de compra', traslado: 'Traslado',
};

function montoStr(n: number | null | undefined, moneda: string): string {
  const v = Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return moneda === 'USD' ? `$ ${v}` : `${moneda} ${v}`;
}

function esEgreso(m: MovimientoCaja): boolean {
  return m.tipo === 'salida' || m.tipo === 'traslado_salida'
    || (m.tipo === 'ajuste' && Number(m.saldo_despues) < Number(m.saldo_antes));
}

async function construirDetalleDoc(mov: MovimientoCaja, orden: Orden | null) {
  const [logoDataUrl, { jsPDF }, { default: autoTable }] = await Promise.all([
    loadLogoDataUrl().catch(() => null),
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const PAGE_W = doc.internal.pageSize.getWidth();
  const MARGIN = 42.52; // 1,5 cm (margen uniforme en todos los lados)
  let y = MARGIN;

  const LOGO_SIZE = 60;
  const TEXT_X = logoDataUrl ? MARGIN + LOGO_SIZE + 14 : MARGIN;
  if (logoDataUrl) { try { doc.addImage(logoDataUrl, 'JPEG', MARGIN, y, LOGO_SIZE, LOGO_SIZE); } catch { /* logo opcional */ } }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text('DETALLE DE MOVIMIENTO', TEXT_X, y + 20);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`${mov.caja?.nombre ?? '—'} · ${dateTime(mov.at)}`, TEXT_X, y + 38);
  doc.text(`Generado: ${dateTime(new Date().toISOString())}`, PAGE_W - MARGIN, y + 38, { align: 'right' });
  y += Math.max(LOGO_SIZE, 42) + 8;

  doc.setDrawColor(255, 138, 0);
  doc.setLineWidth(1.5);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 14;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('Mineral Group Guayana C.A. · Sistema de Gestión de Inventarios', MARGIN, y);
  y += 8;

  const signo = esEgreso(mov) ? '-' : '+';
  const filasMov: Array<[string, string]> = [
    ['Fecha', dateTime(mov.at)],
    ['Caja', mov.caja?.nombre ?? '—'],
    ['Tipo de movimiento', TIPO_LABEL[mov.tipo] ?? mov.tipo],
    ['Categoría', CAT_LABEL[mov.categoria ?? ''] ?? (mov.categoria || '—')],
    ['Monto', `${signo}${montoStr(mov.monto, mov.moneda)}`],
  ];
  if (mov.cuenta) filasMov.push(['Cuenta', String(mov.cuenta)]);
  if (mov.tasa_bs != null && mov.tasa_bs > 0) filasMov.push(['Tasa aplicada', `${montoStr(mov.tasa_bs, 'Bs')} / $`]);
  filasMov.push(['Saldo antes', montoStr(mov.saldo_antes, mov.moneda)]);
  filasMov.push(['Saldo después', montoStr(mov.saldo_despues, mov.moneda)]);
  if (mov.beneficiario) filasMov.push(['Beneficiario', String(mov.beneficiario)]);
  if (mov.destino) filasMov.push(['Destino', String(mov.destino)]);
  filasMov.push(['Registrado por', mov.actor_name || mov.actor]);
  if (mov.motivo) filasMov.push(['Concepto / motivo', String(mov.motivo)]);

  autoTable(doc, {
    startY: y + 6,
    head: [['Movimiento', '']],
    body: filasMov,
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    styles: { fontSize: 9, cellPadding: 4, overflow: 'linebreak' },
    headStyles: { fillColor: [255, 138, 0], textColor: 255, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 150, fontStyle: 'bold' }, 1: { cellWidth: 'auto' } },
  });

  // Orden pagada (si el movimiento es un pago de compra vinculado a una OC).
  if (orden) {
    const seriales = orden.seriales_billetes ?? [];
    const filasOrden: Array<[string, string]> = [
      ['OP', orden.codigo],
      ['N°ODC', orden.oc_codigo ?? '—'],
      ['Total OC', montoStr(orden.total, 'USD')],
    ];
    if (orden.recibido_total != null) filasOrden.push(['Recibido', montoStr(Number(orden.recibido_total), 'USD')]);
    filasOrden.push(['Solicitante', orden.solicitante || orden.solicitante_email]);
    if (orden.condiciones_pago) filasOrden.push(['Condición de pago', labelCondicionPago(orden.condiciones_pago)]);
    if (orden.pagada_en) filasOrden.push(['Pagada', dateTime(orden.pagada_en)]);
    filasOrden.push(['Seriales de billetes', seriales.length ? seriales.join('  ·  ') : 'No se registraron seriales']);
    filasOrden.push(['Comprobante', orden.factura_path ? (orden.factura_nombre || 'Adjunto') : 'No se subió (efectivo, opcional)']);

    // @ts-expect-error lastAutoTable lo agrega el plugin en runtime
    const afterY = (doc.lastAutoTable?.finalY ?? y) + 18;
    autoTable(doc, {
      startY: afterY,
      head: [['Orden pagada', '']],
      body: filasOrden,
      margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      styles: { fontSize: 9, cellPadding: 4, overflow: 'linebreak' },
      headStyles: { fillColor: [255, 138, 0], textColor: 255, fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 150, fontStyle: 'bold' }, 1: { cellWidth: 'auto' } },
    });
  }

  return doc;
}

function nombreArchivo(mov: MovimientoCaja, orden: Orden | null): string {
  const ref = orden?.oc_codigo || orden?.codigo || mov.id.slice(0, 8);
  return `movimiento-${ref}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/(^-|-$)/g, '') + '.pdf';
}

/** Descarga el detalle del movimiento como PDF. */
export async function descargarMovimientoDetallePdf(mov: MovimientoCaja, orden: Orden | null): Promise<void> {
  const doc = await construirDetalleDoc(mov, orden);
  doc.save(nombreArchivo(mov, orden));
}

/** Genera el detalle y devuelve el base64 (sin el prefijo data:) + nombre, para el correo. */
export async function obtenerMovimientoDetalleBase64(mov: MovimientoCaja, orden: Orden | null): Promise<{ base64: string; nombre: string }> {
  const doc = await construirDetalleDoc(mov, orden);
  const dataUri = doc.output('datauristring');
  const base64 = dataUri.split(',')[1] ?? '';
  return { base64, nombre: nombreArchivo(mov, orden) };
}
