/* ============================================================
   MGG · Tesorería · Resumen PDF de OC pendientes por pagar
   N° OC · Finalidad · Proveedor · Monto. Solo por botón (vista previa).
   ============================================================ */
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import type { OrdenPorPagar } from '@/modules/pedidos/pedidos.repository';

function money(n: number | null | undefined): string {
  return `$ ${Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export async function descargarResumenPorPagarPdf(rows: OrdenPorPagar[]): Promise<void> {
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
  doc.text('ÓRDENES DE COMPRA PENDIENTES POR PAGAR', W / 2 + 28, y + 26, { align: 'center' });
  doc.setTextColor(0, 0, 0);
  y += 50;

  // Finalidad de la OC: la del encabezado o, si está vacía, la unión de las finalidades
  // por ítem (es donde suele quedar cargada). Notas = la nota libre de la OC.
  const finalidadDe = (r: OrdenPorPagar): string => {
    const o = r.orden;
    const cab = (o.finalidad ?? '').trim();
    if (cab) return cab;
    const porItem = Array.from(new Set((o.items ?? []).map((it) => (it.finalidad ?? '').trim()).filter(Boolean)));
    return porItem.length ? porItem.join(' · ') : '—';
  };
  const notasDe = (r: OrdenPorPagar): string => (r.orden.notas ?? r.orden.motivo ?? '').trim() || '—';

  const total = rows.reduce((a, r) => a + (Number(r.montoAPagar) || 0), 0);
  const body = rows.map((r, i) => [
    String(i + 1),
    r.orden.oc_codigo ?? r.orden.codigo,
    r.proveedorNombre,
    finalidadDe(r),
    notasDe(r),
    r.esperandoMetodo ? 'Esperando método de pago' : 'Lista para pagar',
    money(r.montoAPagar),
  ]);

  autoTable(doc, {
    startY: y,
    head: [['ITEM', 'N°OC', 'PROVEEDOR', 'FINALIDAD', 'NOTAS', 'ESTADO', 'MONTO $']],
    body,
    foot: [['', '', '', '', '', 'TOTAL', money(total)]],
    tableWidth: 'auto',
    styles: { fontSize: 8, cellPadding: 3.5, valign: 'middle', overflow: 'linebreak' },
    headStyles: { fillColor: [210, 210, 210], textColor: [20, 20, 20], fontStyle: 'bold', halign: 'center' },
    footStyles: { fillColor: [255, 138, 0], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'right' },
    columnStyles: {
      0: { halign: 'center', cellWidth: 26 },
      1: { halign: 'center', cellWidth: 62 },
      2: { cellWidth: 118 },
      3: { cellWidth: 150 },
      4: { cellWidth: 150 },
      5: { halign: 'center', cellWidth: 72 },
      6: { halign: 'right', cellWidth: 58 },
    },
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  });

  doc.setFontSize(8); doc.setTextColor(120, 120, 120);
  doc.text(`Generado ${fmt.dateTime(new Date().toISOString())} · ${rows.length} OC · Mineral Group Guayana C.A.`, MARGIN, doc.internal.pageSize.getHeight() - 16);

  previewPdfDoc(doc, 'oc-por-pagar.pdf');
}
