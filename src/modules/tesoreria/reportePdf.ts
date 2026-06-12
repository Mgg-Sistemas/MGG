/* ============================================================
   MGG · Tesorería · Reporte PDF de movimientos / caja
   Reusa la estética del PDF de Orden de Compra (logo, franja naranja,
   emisor, tabla con autoTable y totales). Sirve para el Registro de
   Movimientos y para una caja puntual. Devuelve el doc para descargar
   o el base64 para enviarlo por correo (Edge Function enviar-reporte).
   ============================================================ */
import { dateTime } from '@/shared/lib/format';
import { loadLogoDataUrl } from '@/shared/lib/pdfLogo';
import type { MovimientoCaja } from '@/shared/lib/types';

const TIPO_LABEL: Record<string, string> = {
  ingreso: 'Ingreso', salida: 'Egreso', traslado_salida: 'Traslado (sale)',
  traslado_entrada: 'Traslado (entra)', ajuste: 'Ajuste',
};
const CAT_LABEL: Record<string, string> = {
  gasto: 'Gasto', pago_personal: 'Pago a personal', pago_oc: 'Pago de compra', traslado: 'Traslado',
};

export interface ReporteMeta {
  titulo: string;        // "REPORTE DE MOVIMIENTOS" / "REPORTE DE CAJA"
  subtitulo?: string;    // caja / filtros aplicados
}

function montoStr(n: number | null | undefined, moneda: string): string {
  const v = Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return moneda === 'USD' ? `$ ${v}` : `${moneda} ${v}`;
}

async function construirDoc(movs: MovimientoCaja[], meta: ReporteMeta) {
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
  doc.text(meta.titulo, TEXT_X, y + 20);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  if (meta.subtitulo) doc.text(meta.subtitulo, TEXT_X, y + 38);
  doc.text(`Generado: ${dateTime(new Date().toISOString())}`, PAGE_W - MARGIN, y + 38, { align: 'right' });
  y += Math.max(LOGO_SIZE, 42) + 8;

  doc.setDrawColor(255, 138, 0);
  doc.setLineWidth(1.5);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 16;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('Mineral Group Guayana C.A. · Sistema de Gestión de Inventarios', MARGIN, y);
  doc.text(`${movs.length} movimiento(s)`, PAGE_W - MARGIN, y, { align: 'right' });
  y += 10;

  const filas = movs.map((m) => {
    const egreso = m.tipo === 'salida' || m.tipo === 'traslado_salida';
    // En traslados, "destino" es la caja contraparte: a dónde fue (sale) o de
    // dónde vino (entra) el dinero. Lo mostramos para ver la caja involucrada.
    const destinoLabel = m.destino
      ? (m.tipo === 'traslado_salida' ? `→ ${m.destino}` : m.tipo === 'traslado_entrada' ? `← ${m.destino}` : m.destino)
      : null;
    const concepto = [CAT_LABEL[m.categoria ?? ''], m.beneficiario, m.motivo, destinoLabel].filter(Boolean).join(' · ') || '—';
    return [
      dateTime(m.at),
      m.caja?.nombre ?? '—',
      TIPO_LABEL[m.tipo] ?? m.tipo,
      concepto,
      `${egreso ? '-' : '+'}${montoStr(m.monto, m.moneda)}`,
      montoStr(m.saldo_despues, m.moneda),
    ];
  });

  autoTable(doc, {
    startY: y + 6,
    head: [['Fecha', 'Caja', 'Movimiento', 'Concepto', 'Monto', 'Saldo']],
    body: filas,
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    styles: { fontSize: 7.5, cellPadding: 3, overflow: 'linebreak' },
    headStyles: { fillColor: [255, 138, 0], textColor: 255, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 80 }, 1: { cellWidth: 70 }, 2: { cellWidth: 70 },
      3: { cellWidth: 'auto' }, 4: { cellWidth: 70, halign: 'right' }, 5: { cellWidth: 70, halign: 'right' },
    },
  });

  return doc;
}

function nombreArchivo(meta: ReporteMeta): string {
  const base = meta.titulo.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return `${base || 'reporte'}.pdf`;
}

/** Descarga el reporte de movimientos como PDF. */
export async function descargarReportePdf(movs: MovimientoCaja[], meta: ReporteMeta): Promise<void> {
  const doc = await construirDoc(movs, meta);
  doc.save(nombreArchivo(meta));
}

/** Genera el reporte y devuelve el base64 (sin el prefijo data:) + nombre, para el correo. */
export async function obtenerReporteBase64(movs: MovimientoCaja[], meta: ReporteMeta): Promise<{ base64: string; nombre: string }> {
  const doc = await construirDoc(movs, meta);
  const dataUri = doc.output('datauristring');
  const base64 = dataUri.split(',')[1] ?? '';
  return { base64, nombre: nombreArchivo(meta) };
}
