import { dateTime, money, num } from '@/shared/lib/format';
import { loadLogoDataUrl } from '@/shared/lib/pdfLogo';

export interface DemandaRow {
  sku: string;
  nombre: string;
  cantidad: number;
  monto: number;
  ordenes: number;
}

export interface DemandaMeta {
  metrica: 'cantidad' | 'monto';
  /** Descripción del período/filtro aplicado (día, mes o rango). */
  periodo: string;
  /** Cantidad de órdenes consideradas en el análisis. */
  totalOrdenes: number;
}

function truncar(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/**
 * Genera y descarga un PDF con el ranking de materiales más demandados:
 * un gráfico de barras (top 10) + la tabla completa de datos.
 * Reusa el patrón de los otros PDFs (jsPDF + autotable, lazy import, logo).
 */
export async function descargarDemandaPdf(rows: DemandaRow[], meta: DemandaMeta): Promise<void> {
  const [logoDataUrl, { jsPDF }, { default: autoTable }] = await Promise.all([
    loadLogoDataUrl().catch(() => null),
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const PAGE_W = doc.internal.pageSize.getWidth();
  const MARGIN = 42.52; // 1,5 cm (margen uniforme en todos los lados)
  let y = MARGIN;

  // ─── Header ────────────────────────────────────────────
  const LOGO_SIZE = 56;
  const TEXT_X = logoDataUrl ? MARGIN + LOGO_SIZE + 14 : MARGIN;
  if (logoDataUrl) {
    try { doc.addImage(logoDataUrl, 'JPEG', MARGIN, y, LOGO_SIZE, LOGO_SIZE); } catch { /* logo opcional */ }
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('Materiales con más demanda', TEXT_X, y + 18);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Mineral Group Guayana C.A. · Generado ${dateTime(new Date().toISOString())}`, TEXT_X, y + 36);
  y += Math.max(LOGO_SIZE, 36) + 10;

  doc.setDrawColor(200);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 16;

  // ─── Criterio / período ────────────────────────────────
  const metricaLabel = meta.metrica === 'cantidad' ? 'Cantidad (unidades)' : 'Monto total ($)';
  doc.setFontSize(10);
  doc.setTextColor(60);
  doc.text(`Criterio: ${metricaLabel}   ·   Órdenes consideradas: ${meta.totalOrdenes}   ·   Productos: ${rows.length}`, MARGIN, y);
  y += 14;
  doc.text(`Período: ${meta.periodo}`, MARGIN, y);
  y += 18;
  doc.setTextColor(20);

  if (!rows.length) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(11);
    doc.text('No hay datos de demanda para el período seleccionado.', MARGIN, y + 6);
    doc.save('materiales-demanda.pdf');
    return;
  }

  // ─── Gráfico de barras (top 10) ────────────────────────
  const valOf = (r: DemandaRow) => (meta.metrica === 'cantidad' ? r.cantidad : r.monto);
  const top = rows.slice(0, 10);
  const max = Math.max(1, ...top.map(valOf));

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(`Top ${top.length} por ${meta.metrica === 'cantidad' ? 'cantidad' : 'monto'}`, MARGIN, y);
  y += 14;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);

  const LABEL_W = 120;
  const VALUE_W = 70;
  const chartX = MARGIN + LABEL_W;
  const chartW = PAGE_W - MARGIN - chartX - VALUE_W;
  const barH = 13;
  const gap = 8;
  for (const r of top) {
    const v = valOf(r);
    const w = Math.max(1, (v / max) * chartW);
    const label = r.sku && r.sku !== '—' ? r.sku : r.nombre;
    doc.setTextColor(40);
    doc.text(truncar(label, 24), MARGIN, y + barH - 3);
    doc.setFillColor(255, 138, 0); // naranja de marca
    doc.rect(chartX, y, w, barH, 'F');
    doc.text(meta.metrica === 'cantidad' ? num(v) : money(v), chartX + w + 4, y + barH - 3);
    y += barH + gap;
  }
  y += 12;

  // ─── Tabla completa ────────────────────────────────────
  autoTable(doc, {
    startY: y,
    head: [['#', 'SKU', 'Producto', 'Cantidad', 'Órdenes', 'Monto total']],
    body: rows.map((r, i) => [String(i + 1), r.sku, r.nombre, num(r.cantidad), num(r.ordenes), money(r.monto)]),
    theme: 'grid',
    headStyles: { fillColor: [230, 230, 230], textColor: 20 },
    styles: { fontSize: 9, cellPadding: 4 },
    columnStyles: { 0: { cellWidth: 26, halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  });

  // ─── Footer ────────────────────────────────────────────
  const pageH = doc.internal.pageSize.getHeight();
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(`Documento auto-generado · ${dateTime(new Date().toISOString())}`, MARGIN, pageH - 24);

  doc.save(`materiales-demanda-${new Date().toISOString().slice(0, 10)}.pdf`);
}
