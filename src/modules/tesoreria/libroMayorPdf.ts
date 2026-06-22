/* ============================================================
   MGG · Tesorería · Reporte PDF del Libro Mayor por moneda
   Fecha · Caja · Concepto · Beneficiario/Motivo · Debe · Haber · Saldo.
   Solo por botón (vista previa).
   ============================================================ */
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import type { MovimientoCaja } from '@/shared/lib/types';

const CAT_LABEL: Record<string, string> = {
  gasto: 'Gasto', pago_personal: 'Pago a personal', pago_oc: 'Pago de compra', pago_nomina: 'Pago de nómina',
  traslado: 'Traslado', conversion: 'Conversión', compra_directa: 'Compra directa',
  cobro_cxc: 'Cobro por cobrar', abono_cxp: 'Abono por pagar', combustible: 'Combustible',
};
const TIPO_LABEL: Record<string, string> = {
  ingreso: 'Ingreso', salida: 'Egreso', traslado_salida: 'Traslado (sale)',
  traslado_entrada: 'Traslado (entra)', ajuste: 'Ajuste',
};

function esEgreso(m: MovimientoCaja): boolean {
  return m.tipo === 'salida' || m.tipo === 'traslado_salida'
    || (m.tipo === 'ajuste' && Number(m.saldo_despues) < Number(m.saldo_antes));
}

export async function descargarLibroMayorMonedaPdf(moneda: string, movs: MovimientoCaja[], rango: string): Promise<void> {
  const [{ jsPDF }, { default: autoTable }, fmt, { loadLogoDataUrl }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('@/shared/lib/format'),
    import('@/shared/lib/pdfLogo'),
  ]);
  const money = (n: number | null | undefined): string => {
    const v = Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return moneda === 'USD' ? `$ ${v}` : `${moneda} ${v}`;
  };

  const logo = await loadLogoDataUrl().catch(() => null);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  const W = doc.internal.pageSize.getWidth();
  const MARGIN = 42.52;
  let y = MARGIN;
  if (logo) { try { doc.addImage(logo, 'JPEG', MARGIN, y, 44, 44); } catch { /* opcional */ } }

  doc.setTextColor(255, 138, 0); doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  doc.text(`LIBRO MAYOR · ${moneda}`, W / 2 + 28, y + 22, { align: 'center' });
  doc.setTextColor(120, 120, 120); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(`${rango} · ${movs.length} movimiento(s)`, W / 2 + 28, y + 38, { align: 'center' });
  doc.setTextColor(0, 0, 0);
  y += 54;

  const ordenados = [...movs].sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  const debe = ordenados.filter((m) => !esEgreso(m)).reduce((a, m) => a + Math.abs(Number(m.monto) || 0), 0);
  const haber = ordenados.filter((m) => esEgreso(m)).reduce((a, m) => a + Math.abs(Number(m.monto) || 0), 0);

  const body = ordenados.map((m) => {
    const egr = esEgreso(m);
    const v = Math.abs(Number(m.monto) || 0);
    const concepto = CAT_LABEL[m.categoria ?? ''] ?? m.categoria ?? (TIPO_LABEL[m.tipo] ?? m.tipo);
    return [
      fmt.dateTime(m.at),
      m.caja?.nombre ?? '—',
      concepto,
      m.beneficiario || m.motivo || m.destino || '—',
      egr ? '' : money(v),
      egr ? money(v) : '',
      money(m.saldo_despues),
    ];
  });

  autoTable(doc, {
    startY: y,
    head: [['Fecha', 'Caja', 'Concepto', 'Beneficiario / motivo', 'Debe', 'Haber', 'Saldo']],
    body,
    foot: [[`Totales (${ordenados.length} mov.)`, '', '', '', money(debe), money(haber), `Neto ${money(debe - haber)}`]],
    styles: { fontSize: 8, cellPadding: 3.5, valign: 'middle', overflow: 'linebreak' },
    headStyles: { fillColor: [210, 210, 210], textColor: [20, 20, 20], fontStyle: 'bold', halign: 'center' },
    footStyles: { fillColor: [240, 240, 240], textColor: [20, 20, 20], fontStyle: 'bold', halign: 'right' },
    columnStyles: {
      0: { cellWidth: 92 },
      1: { cellWidth: 70 },
      2: { cellWidth: 90 },
      3: { cellWidth: 'auto' },
      4: { halign: 'right', cellWidth: 80 },
      5: { halign: 'right', cellWidth: 80 },
      6: { halign: 'right', cellWidth: 84 },
    },
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  });

  doc.setFontSize(8); doc.setTextColor(120, 120, 120);
  doc.text(`Generado ${fmt.dateTime(new Date().toISOString())} · Mineral Group Guayana C.A.`, MARGIN, doc.internal.pageSize.getHeight() - 16);

  previewPdfDoc(doc, `libro-mayor-${moneda.toLowerCase()}.pdf`);
}
