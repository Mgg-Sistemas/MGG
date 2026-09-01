/* ============================================================
   MGG · Control de Alimentación (Cocina) · Reporte PDF
   Resumen de consumo + detalle de comidas. Solo por botón (vista previa).
   ============================================================ */
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import type { CocinaComida } from '@/shared/lib/types';
import { labelTipoComida, resumirComidas } from './cocina.repository';

function money(n: number | null | undefined): string {
  return `$ ${Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function num(n: number | null | undefined): string {
  return Number(n || 0).toLocaleString('es-VE', { maximumFractionDigits: 2 });
}

export async function descargarReporteCocinaPdf(comidas: CocinaComida[], rangoLabel: string): Promise<void> {
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
  doc.text('CONTROL DE ALIMENTACIÓN (COCINA)', W / 2 + 28, y + 20, { align: 'center' });
  doc.setTextColor(90, 90, 90); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(rangoLabel, W / 2 + 28, y + 36, { align: 'center' });
  doc.setTextColor(0, 0, 0);
  y += 56;

  const r = resumirComidas(comidas);
  // Tarjetas-resumen (texto)
  doc.setFontSize(10); doc.setFont('helvetica', 'bold');
  doc.text(
    `Platos: ${num(r.platos)}   ·   Consumo total: ${money(r.valor)}   ·   Promedio por plato: ${money(r.promedioPorPlato)}`,
    MARGIN, y,
  );
  y += 14;

  // Top víveres consumidos
  if (r.topViveres.length) {
    autoTable(doc, {
      startY: y + 6,
      head: [['VÍVERES MÁS CONSUMIDOS', 'CANTIDAD', 'VALOR $']],
      body: r.topViveres.slice(0, 15).map((v) => [`${v.nombre} (${v.sku})`, num(v.cantidad), money(v.valor)]),
      styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak' },
      headStyles: { fillColor: [210, 210, 210], textColor: [20, 20, 20], fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 360 }, 1: { halign: 'right', cellWidth: 160 }, 2: { halign: 'right', cellWidth: 120 } },
      margin: { left: MARGIN, right: MARGIN },
    });
    // @ts-expect-error lastAutoTable lo agrega el plugin
    y = doc.lastAutoTable.finalY + 14;
  }

  // Detalle de comidas
  autoTable(doc, {
    startY: y,
    head: [['N°', 'FECHA · HORA', 'COMIDA', 'PLATOS', 'VÍVERES', 'VALOR $', 'PROM./PLATO']],
    body: comidas.map((c) => [
      c.codigo,
      fmt.dateTime(c.at),
      labelTipoComida(c.tipo_comida),
      num(c.platos),
      (c.items ?? []).map((it) => `${it.nombre} ×${num(it.cantidad)}`).join(', '),
      money(c.valor_total),
      money(Number(c.platos) > 0 ? c.valor_total / Number(c.platos) : 0),
    ]),
    foot: [['', '', '', num(r.platos), '', money(r.valor), money(r.promedioPorPlato)]],
    styles: { fontSize: 7.5, cellPadding: 3, valign: 'middle', overflow: 'linebreak' },
    headStyles: { fillColor: [210, 210, 210], textColor: [20, 20, 20], fontStyle: 'bold', halign: 'center' },
    footStyles: { fillColor: [255, 138, 0], textColor: [255, 255, 255], fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 70 }, 1: { cellWidth: 110 }, 2: { cellWidth: 70 },
      3: { halign: 'right', cellWidth: 50 }, 4: { cellWidth: 240 },
      5: { halign: 'right', cellWidth: 90 }, 6: { halign: 'right', cellWidth: 77 },
    },
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  });

  doc.setFontSize(8); doc.setTextColor(120, 120, 120);
  doc.text(`Generado ${fmt.dateTime(new Date().toISOString())} · ${comidas.length} comida(s) · Mineral Group Guayana C.A.`, MARGIN, doc.internal.pageSize.getHeight() - 16);

  previewPdfDoc(doc, 'cocina-consumo.pdf');
}
