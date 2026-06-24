/* ============================================================
   MGG · Tesorería · Resumen PDF de Cuentas por Cobrar
   Tipo · Contraparte · Detalle · Moneda · Debe · Abonado · Saldo.
   Multi-moneda: el total se desglosa por moneda. Vista previa.
   ============================================================ */
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import type { CuentaPorCobrar } from './cuentasPorCobrar.repository';

function simbolo(moneda: string): string {
  if (moneda === 'USD' || moneda === 'USDT') return '$';
  if (moneda === 'Bs') return 'Bs';
  if (moneda === 'COP') return 'COP';
  return moneda;
}
function money(n: number | null | undefined, moneda: string): string {
  return `${simbolo(moneda)} ${Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export async function descargarResumenPorCobrarPdf(rows: CuentaPorCobrar[]): Promise<void> {
  const [{ jsPDF }, { default: autoTable }, fmt, { loadLogoDataUrl }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('@/shared/lib/format'),
    import('@/shared/lib/pdfLogo'),
  ]);
  const logo = await loadLogoDataUrl().catch(() => null);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  const W = doc.internal.pageSize.getWidth();
  const MARGIN = 42.52; // 1,5 cm
  let y = MARGIN;
  if (logo) { try { doc.addImage(logo, 'JPEG', MARGIN, y, 44, 44); } catch { /* opcional */ } }

  doc.setTextColor(255, 138, 0); doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  doc.text('CUENTAS POR COBRAR', W / 2 + 28, y + 26, { align: 'center' });
  doc.setTextColor(0, 0, 0);
  y += 50;

  const tipoLabel = (t: string) => t === 'cliente' ? 'Cliente' : t === 'proveedor' ? 'Proveedor' : t === 'centro' ? 'Centro de costo' : t;
  const detalleDe = (c: CuentaPorCobrar) => (c.nota ?? c.origen ?? '').trim() || '—';
  const saldoDe = (c: CuentaPorCobrar) => Math.round(((Number(c.monto) || 0) - (Number(c.abonado) || 0)) * 100) / 100;

  const body = rows.map((c, i) => [
    String(i + 1),
    tipoLabel(c.tipo),
    c.contraparte,
    detalleDe(c),
    c.moneda,
    money(c.monto, c.moneda),
    money(c.abonado, c.moneda),
    money(saldoDe(c), c.moneda),
  ]);

  // Total del saldo por moneda (no se pueden sumar monedas distintas).
  const saldoPorMoneda = new Map<string, number>();
  rows.forEach((c) => saldoPorMoneda.set(c.moneda, (saldoPorMoneda.get(c.moneda) || 0) + saldoDe(c)));
  const totalTxt = Array.from(saldoPorMoneda.entries()).map(([m, v]) => money(v, m)).join('   ·   ') || '—';

  autoTable(doc, {
    startY: y,
    head: [['ITEM', 'TIPO', 'CONTRAPARTE', 'DETALLE', 'MONEDA', 'DEBE', 'ABONADO', 'SALDO']],
    body,
    foot: [[{ content: 'SALDO TOTAL POR MONEDA', colSpan: 7, styles: { halign: 'right' } }, totalTxt]],
    styles: { fontSize: 8, cellPadding: 3.5, valign: 'middle', overflow: 'linebreak' },
    headStyles: { fillColor: [210, 210, 210], textColor: [20, 20, 20], fontStyle: 'bold', halign: 'center' },
    footStyles: { fillColor: [255, 138, 0], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'right' },
    columnStyles: {
      0: { halign: 'center', cellWidth: 30 },
      1: { cellWidth: 85 },
      2: { cellWidth: 150 },
      3: { cellWidth: 200 },
      4: { halign: 'center', cellWidth: 55 },
      5: { halign: 'right', cellWidth: 67 },
      6: { halign: 'right', cellWidth: 67 },
      7: { halign: 'right', cellWidth: 67 },
    },
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  });

  doc.setFontSize(8); doc.setTextColor(120, 120, 120);
  doc.text(`Generado ${fmt.dateTime(new Date().toISOString())} · ${rows.length} cuenta(s) por cobrar · Mineral Group Guayana C.A.`, MARGIN, doc.internal.pageSize.getHeight() - 16);

  previewPdfDoc(doc, 'cuentas-por-cobrar.pdf');
}
