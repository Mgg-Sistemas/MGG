/* ============================================================
   Centro de Acopio · Resumen Semanal Casiterita · PDF
   Réplica de la hoja «REPORTE PRELIMINAR DE CENTROS DE ACOPIOS».
   ============================================================ */
import type { ResumenSemanal } from './resumenSemanal.repository';
import { computeTotales, acopiadoMggSector, resguardoSector } from './resumenSemanal.repository';

const fmtKg = (v: number) => v.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtUsd = (v: number) => `$${v.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** #rrggbb → [r,g,b] para los fondos de banda en autoTable. */
function hexToRgb(hex?: string): [number, number, number] | undefined {
  if (!hex) return undefined;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return undefined;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export async function descargarResumenSemanalPdf(r: ResumenSemanal): Promise<void> {
  const [{ dateTime }, { loadLogoDataUrl }, { jsPDF }, { default: autoTable }] = await Promise.all([
    import('@/shared/lib/format'), import('@/shared/lib/pdfLogo'), import('jspdf'), import('jspdf-autotable'),
  ]);
  const logo = await loadLogoDataUrl().catch(() => null);

  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  const PAGE_W = doc.internal.pageSize.getWidth();
  const MARGIN = 36;
  let y = MARGIN;

  if (logo) { try { doc.addImage(logo, 'JPEG', MARGIN, y, 44, 44); } catch { /* opcional */ } }
  const tx = logo ? MARGIN + 56 : MARGIN;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
  doc.text('Mineral Group Guayana C.A.', tx, y + 14);
  doc.setFontSize(11);
  doc.text(r.titulo || 'REPORTE PRELIMINAR DE CENTROS DE ACOPIOS', tx, y + 30);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  const periodo = r.periodo_desde || r.periodo_hasta
    ? `Semana: ${r.periodo_desde ?? '—'} → ${r.periodo_hasta ?? '—'}`
    : `Fecha: ${r.fecha}`;
  doc.text(`${r.numero} · ${periodo}`, PAGE_W - MARGIN, y + 14, { align: 'right' });
  doc.text(`Generado: ${dateTime(new Date().toISOString())}`, PAGE_W - MARGIN, y + 28, { align: 'right' });
  y += 50;
  doc.setDrawColor(255, 138, 0); doc.setLineWidth(1.3); doc.line(MARGIN, y, PAGE_W - MARGIN, y); y += 12;

  // Body como la hoja: una fila por centro (numeración continua) y las 4 columnas
  // de la derecha COMBINADAS por bloque (rowSpan en la primera fila del sector).
  type Cell = string | { content: string; rowSpan?: number; styles?: Record<string, unknown> };
  const body: Cell[][] = [];
  let item = 0;
  for (const s of r.filas ?? []) {
    const centros = s.centros ?? [];
    const n = centros.length;
    if (!n) continue;
    const band = hexToRgb(s.color);
    const cellBand = band ? { fillColor: band } : {};
    const acopiadoMgg = acopiadoMggSector(s);
    const resg = resguardoSector(s);
    centros.forEach((c, ci) => {
      item += 1;
      const row: Cell[] = [
        { content: String(item), styles: { ...cellBand, halign: 'center' } },
        { content: c.centro, styles: cellBand },
        { content: fmtKg(Number(c.kg_cobrar) || 0), styles: { ...cellBand, halign: 'right' } },
        { content: fmtKg(Number(c.kg_disponible) || 0), styles: { ...cellBand, halign: 'right' } },
      ];
      if (ci === 0) {
        row.push(
          { content: fmtKg(resg), rowSpan: n, styles: { halign: 'right', valign: 'middle', fontStyle: 'bold' } },
          { content: fmtKg(acopiadoMgg), rowSpan: n, styles: { halign: 'center', valign: 'middle', fontStyle: 'bold', fillColor: [254, 215, 170], textColor: 20 } },
          { content: fmtUsd(Number(s.precio_prom) || 0), rowSpan: n, styles: { halign: 'right', valign: 'middle', fontStyle: 'bold' } },
          { content: fmtUsd(Number(s.saldo_usd) || 0), rowSpan: n, styles: { halign: 'right', valign: 'middle', fontStyle: 'bold' } },
        );
      }
      body.push(row);
    });
  }

  const t = r.totales && Object.keys(r.totales).length ? r.totales : computeTotales(r.filas ?? []);

  autoTable(doc, {
    startY: y,
    head: [[
      'ÍTEM', 'CENTROS DE ACOPIO',
      'Kg Casiterita\npor Cobrar', 'Kg Casiterita\nDisponibles Acopiados',
      'Total Kg resguardos\ny Contratos GT', 'Total Kg Casiterita\nAcopiados por Sector MGG',
      'Precio Promedio\nde Compra por Sector', 'Saldo $USD\npor Sector',
    ]],
    body,
    foot: [[
      { content: 'TOTALES', colSpan: 2, styles: { halign: 'right' } },
      fmtKg(t.kg_cobrar), fmtKg(t.kg_disponible), fmtKg(t.kg_resguardos_gt),
      fmtKg(t.kg_acopiado_mgg), '', fmtUsd(t.saldo_usd),
    ]],
    theme: 'grid',
    headStyles: { fillColor: [255, 138, 0], textColor: 20, fontSize: 7.5, halign: 'center', valign: 'middle' },
    footStyles: { fillColor: [40, 40, 40], textColor: 255, fontStyle: 'bold', halign: 'right' },
    styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak' },
    columnStyles: {
      0: { halign: 'center', cellWidth: 32 },
      1: { cellWidth: 220 },
      2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' },
      5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' },
    },
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  });

  if (r.nota) {
    // @ts-expect-error lastAutoTable lo agrega el plugin
    const fy = doc.lastAutoTable.finalY + 14;
    doc.setFont('helvetica', 'italic'); doc.setFontSize(9);
    doc.text(`Nota: ${r.nota}`, MARGIN, fy);
  }

  doc.save(`resumen-semanal-casiterita-${r.fecha}.pdf`);
}
