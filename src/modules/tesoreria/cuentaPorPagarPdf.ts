/* ============================================================
   MGG · Tesorería · Reporte PDF de una Cuenta por Pagar (crédito)
   Reusa la estética del reporte de movimientos (logo, franja naranja,
   emisor, tabla autoTable). Muestra el resumen (total/abonado/saldo) y el
   historial de abonos. Devuelve el doc para descargar o el base64 para el
   correo (Edge Function enviar-reporte, mismo formato que los demás reportes).
   ============================================================ */
import { dateTime } from '@/shared/lib/format';
import { loadLogoDataUrl } from '@/shared/lib/pdfLogo';
import type { CuentaPorPagar, AbonoCxP, IngresoCxP } from './cuentasPorPagar.repository';

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

function montoStr(n: number | null | undefined, moneda: string): string {
  const v = Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return moneda === 'USD' ? `$ ${v}` : `${moneda} ${v}`;
}

async function construirDoc(cuenta: CuentaPorPagar, abonos: AbonoCxP[], ingresos: IngresoCxP[] = []) {
  const [logoDataUrl, { jsPDF }, { default: autoTable }] = await Promise.all([
    loadLogoDataUrl().catch(() => null),
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const PAGE_W = doc.internal.pageSize.getWidth();
  const MARGIN = 42.52; // 1,5 cm (margen uniforme en todos los lados)
  let y = MARGIN;

  const moneda = cuenta.moneda;
  const tipoLabel = cuenta.tipo === 'proveedor' ? 'Proveedor' : 'Cliente';
  const saldo = round2(Number(cuenta.monto) - (Number(cuenta.abonado) || 0));

  const LOGO_SIZE = 60;
  const TEXT_X = logoDataUrl ? MARGIN + LOGO_SIZE + 14 : MARGIN;
  if (logoDataUrl) { try { doc.addImage(logoDataUrl, 'JPEG', MARGIN, y, LOGO_SIZE, LOGO_SIZE); } catch { /* logo opcional */ } }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('REPORTE DE CUENTA POR PAGAR', TEXT_X, y + 18);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`${tipoLabel}: ${cuenta.contraparte}`, TEXT_X, y + 36);
  doc.text(`Generado: ${dateTime(new Date().toISOString())}`, PAGE_W - MARGIN, y + 36, { align: 'right' });
  y += Math.max(LOGO_SIZE, 42) + 8;

  doc.setDrawColor(255, 138, 0);
  doc.setLineWidth(1.5);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 16;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('Mineral Group Guayana C.A. · Sistema de Gestión de Inventarios', MARGIN, y);
  doc.text(`Estado: ${cuenta.estado === 'saldada' ? 'Saldada' : 'Abierta'}`, PAGE_W - MARGIN, y, { align: 'right' });
  y += 14;

  // Resumen (Total / Abonado / Saldo).
  autoTable(doc, {
    startY: y,
    head: [['Total', 'Abonado', 'Saldo pendiente']],
    body: [[montoStr(cuenta.monto, moneda), montoStr(cuenta.abonado, moneda), montoStr(saldo, moneda)]],
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    styles: { fontSize: 10, cellPadding: 6, halign: 'center', fontStyle: 'bold' },
    headStyles: { fillColor: [255, 138, 0], textColor: 255, fontStyle: 'bold', halign: 'center' },
  });
  // @ts-expect-error lastAutoTable lo añade el plugin autoTable en runtime.
  y = (doc.lastAutoTable?.finalY ?? y) + 14;

  if (cuenta.nota) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'italic');
    doc.text(`Nota: ${cuenta.nota}`, MARGIN, y);
    y += 14;
  }

  // Detalle de ingresos (cada entrada de dinero del cliente/proveedor con su fecha + acumulado).
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Detalle de ingresos (fechas)', MARGIN, y);
  y += 6;
  let acc = 0;
  const filasIng = ingresos.map((ing, i) => {
    acc = round2(acc + Number(ing.monto));
    return [String(i + 1), dateTime(ing.at), montoStr(ing.monto, ing.moneda), montoStr(acc, ing.moneda), ing.nota || '—'];
  });
  autoTable(doc, {
    startY: y + 4,
    head: [['#', 'Fecha', 'Ingreso', 'Acumulado (se debe)', 'Nota']],
    body: filasIng.length ? filasIng : [['—', '—', 'Sin ingresos registrados', '—', '—']],
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    styles: { fontSize: 8.5, cellPadding: 4, overflow: 'linebreak' },
    headStyles: { fillColor: [255, 138, 0], textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [255, 138, 0], textColor: 255, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 26, halign: 'right' }, 1: { cellWidth: 120 },
      2: { cellWidth: 90, halign: 'right' }, 3: { cellWidth: 110, halign: 'right', fontStyle: 'bold' }, 4: { cellWidth: 'auto' },
    },
    foot: [[
      { content: 'Total prestado', colSpan: 2, styles: { halign: 'right', fontStyle: 'bold' } },
      { content: montoStr(cuenta.monto, moneda), styles: { halign: 'right', fontStyle: 'bold' } },
      { content: `Se debe ${montoStr(saldo, moneda)}`, colSpan: 2, styles: { halign: 'right', fontStyle: 'bold' } },
    ]],
  });
  // @ts-expect-error lastAutoTable lo añade el plugin autoTable en runtime.
  y = (doc.lastAutoTable?.finalY ?? y) + 14;

  // Historial de abonos.
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Historial de abonos', MARGIN, y);
  y += 6;

  const filas = abonos.map((ab) => [
    dateTime(ab.at),
    montoStr(ab.monto, ab.moneda),
    ab.saldo_restante != null ? montoStr(ab.saldo_restante, ab.moneda) : '—',
    ab.nota || '—',
  ]);

  autoTable(doc, {
    startY: y + 4,
    head: [['Fecha', 'Abono', 'Saldo restante', 'Nota']],
    body: filas.length ? filas : [['—', 'Sin abonos registrados', '—', '—']],
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    styles: { fontSize: 8.5, cellPadding: 4, overflow: 'linebreak' },
    headStyles: { fillColor: [255, 138, 0], textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [255, 138, 0], textColor: 255, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 130 }, 1: { cellWidth: 90, halign: 'right' },
      2: { cellWidth: 100, halign: 'right' }, 3: { cellWidth: 'auto' },
    },
    foot: [[
      { content: `${abonos.length} abono(s) · Total abonado`, colSpan: 2, styles: { halign: 'right', fontStyle: 'bold' } },
      { content: montoStr(cuenta.abonado, moneda), colSpan: 2, styles: { halign: 'right', fontStyle: 'bold' } },
    ]],
  });

  return doc;
}

function nombreArchivo(cuenta: CuentaPorPagar): string {
  const base = `cuenta-por-pagar-${cuenta.contraparte}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return `${base || 'cuenta-por-pagar'}.pdf`;
}

/** Descarga la cuenta por pagar (con sus ingresos y su historial de abonos) como PDF. */
export async function descargarCuentaPorPagarPdf(cuenta: CuentaPorPagar, abonos: AbonoCxP[], ingresos: IngresoCxP[] = []): Promise<void> {
  const doc = await construirDoc(cuenta, abonos, ingresos);
  doc.save(nombreArchivo(cuenta));
}

/** Genera el PDF y devuelve el base64 (sin prefijo) + nombre, para el correo. */
export async function obtenerCuentaPorPagarBase64(cuenta: CuentaPorPagar, abonos: AbonoCxP[], ingresos: IngresoCxP[] = []): Promise<{ base64: string; nombre: string }> {
  const doc = await construirDoc(cuenta, abonos, ingresos);
  const dataUri = doc.output('datauristring');
  const base64 = dataUri.split(',')[1] ?? '';
  return { base64, nombre: nombreArchivo(cuenta) };
}
