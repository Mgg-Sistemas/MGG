/* ============================================================
   MGG · Tesorería · Resumen PDF de Cuentas a Crédito (cuentas abiertas)
   N° OC · Proveedor · Finalidad · Total · Abonado · Saldo. Vista previa.
   ============================================================ */
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import type { OrdenPorPagar } from '@/modules/pedidos/pedidos.repository';

function money(n: number | null | undefined): string {
  return `$ ${Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export async function descargarResumenCreditosPdf(rows: OrdenPorPagar[]): Promise<void> {
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
  doc.text('CUENTAS A CRÉDITO · CUENTAS ABIERTAS', W / 2 + 28, y + 26, { align: 'center' });
  doc.setTextColor(0, 0, 0);
  y += 50;

  const finalidadDe = (r: OrdenPorPagar): string => {
    const o = r.orden;
    const cab = (o.finalidad ?? '').trim();
    if (cab) return cab;
    const porItem = Array.from(new Set((o.items ?? []).map((it) => (it.finalidad ?? '').trim()).filter(Boolean)));
    return porItem.length ? porItem.join(' · ') : '—';
  };
  const totalDe = (r: OrdenPorPagar) => Number(r.orden.total) || 0;
  const abonadoDe = (r: OrdenPorPagar) => Number(r.orden.abonado_total) || 0;
  const saldoDe = (r: OrdenPorPagar) => Math.round((totalDe(r) - abonadoDe(r)) * 100) / 100;

  const sumTotal = rows.reduce((a, r) => a + totalDe(r), 0);
  const sumAbon = rows.reduce((a, r) => a + abonadoDe(r), 0);
  const sumSaldo = rows.reduce((a, r) => a + saldoDe(r), 0);

  const body = rows.map((r, i) => [
    String(i + 1),
    r.orden.oc_codigo ?? r.orden.codigo,
    r.proveedorNombre,
    finalidadDe(r),
    money(totalDe(r)),
    money(abonadoDe(r)),
    money(saldoDe(r)),
  ]);

  autoTable(doc, {
    startY: y,
    head: [['ITEM', 'N°OC', 'PROVEEDOR', 'FINALIDAD', 'TOTAL $', 'ABONADO $', 'SALDO $']],
    body,
    foot: [['', '', '', 'TOTAL', money(sumTotal), money(sumAbon), money(sumSaldo)]],
    styles: { fontSize: 8, cellPadding: 3.5, valign: 'middle', overflow: 'linebreak' },
    headStyles: { fillColor: [210, 210, 210], textColor: [20, 20, 20], fontStyle: 'bold', halign: 'center' },
    footStyles: { fillColor: [255, 138, 0], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'right' },
    columnStyles: {
      0: { halign: 'center', cellWidth: 30 },
      1: { halign: 'center', cellWidth: 70 },
      2: { cellWidth: 150 },
      3: { cellWidth: 215 },
      4: { halign: 'right', cellWidth: 80 },
      5: { halign: 'right', cellWidth: 80 },
      6: { halign: 'right', cellWidth: 82 },
    },
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  });

  doc.setFontSize(8); doc.setTextColor(120, 120, 120);
  doc.text(`Generado ${fmt.dateTime(new Date().toISOString())} · ${rows.length} cuenta(s) a crédito · Mineral Group Guayana C.A.`, MARGIN, doc.internal.pageSize.getHeight() - 16);

  previewPdfDoc(doc, 'cuentas-credito.pdf');
}
