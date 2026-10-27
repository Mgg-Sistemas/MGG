/* ============================================================
   Golden Touch · Servicio de Mantenimiento · Resumen PDF (vista previa)
   Por equipo del grupo activo: status, horómetro, HRS restantes y
   consumos del período (aceite / gasoil / refrigerante / filtros).
   ============================================================ */
import { previewPdf } from '@/shared/lib/reportePreview';
import { dibujarLogoPdf } from '@/shared/lib/pdfLogo';

export interface ResumenMantRow {
  equipo: string;
  status: string;
  horometro: number | null;
  restantes: number | null;
  aceite: number;
  gasoil: number;
  refrigerante: number;
  filtros: number;
}

const n = (v: number | null | undefined) =>
  Number(v ?? 0).toLocaleString('es-VE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export async function descargarResumenMantenimientoPdf(
  grupo: string,
  rows: ResumenMantRow[],
  rango: { desde: string; hasta: string },
): Promise<void> {
  const [{ jsPDF }, { default: autoTable }, fmt, { loadLogoPdfDataUrl }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('@/shared/lib/format'),
    import('@/shared/lib/pdfLogo'),
  ]);
  const logo = await loadLogoPdfDataUrl().catch(() => null);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  const W = doc.internal.pageSize.getWidth();
  const MARGIN = 56.69; // 2 cm por lado
  let y = MARGIN;
  if (logo) { dibujarLogoPdf(doc, logo, MARGIN, y, 44); }

  doc.setTextColor(255, 138, 0); doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  doc.text('SERVICIO DE MANTENIMIENTO', W / 2 + 28, y + 20, { align: 'center' });
  doc.setFontSize(11); doc.setTextColor(60, 60, 60);
  doc.text(grupo, W / 2 + 28, y + 38, { align: 'center' });
  doc.setTextColor(0, 0, 0);
  y += 56;

  const rangoTxt = rango.desde || rango.hasta
    ? `Período: ${rango.desde ? fmt.date(rango.desde) : '…'} — ${rango.hasta ? fmt.date(rango.hasta) : 'hoy'}`
    : 'Período: todo el histórico';
  doc.setFontSize(9); doc.setTextColor(90, 90, 90);
  doc.text(rangoTxt, MARGIN, y); y += 14;
  doc.setTextColor(0, 0, 0);

  const body = rows.map((r, i) => [
    String(i + 1),
    r.equipo,
    r.status,
    r.horometro != null ? n(r.horometro) : '—',
    r.restantes != null ? `${n(r.restantes)} h` : '—',
    n(r.aceite),
    n(r.gasoil),
    n(r.refrigerante),
    n(r.filtros),
  ]);

  const tot = rows.reduce((a, r) => ({
    aceite: a.aceite + r.aceite, gasoil: a.gasoil + r.gasoil,
    refrigerante: a.refrigerante + r.refrigerante, filtros: a.filtros + r.filtros,
  }), { aceite: 0, gasoil: 0, refrigerante: 0, filtros: 0 });

  autoTable(doc, {
    startY: y,
    head: [['ITEM', 'EQUIPO', 'STATUS', 'HORÓMETRO', 'HRS. REST.', 'ACEITE (L)', 'GASOIL (L)', 'REFRIG. (L)', 'FILTROS']],
    body,
    foot: [[
      { content: 'TOTALES', colSpan: 5, styles: { halign: 'right' } },
      n(tot.aceite), n(tot.gasoil), n(tot.refrigerante), n(tot.filtros),
    ]],
    styles: { fontSize: 8, cellPadding: 3.5, valign: 'middle', overflow: 'linebreak' },
    headStyles: { fillColor: [210, 210, 210], textColor: [20, 20, 20], fontStyle: 'bold', halign: 'center' },
    footStyles: { fillColor: [255, 138, 0], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'right' },
    columnStyles: {
      // Con 2 cm por lado el área útil apaisada es 679 pt: las columnas suman 662.
      0: { halign: 'center', cellWidth: 32 },
      1: { cellWidth: 180 },
      2: { cellWidth: 85 },
      3: { halign: 'right', cellWidth: 70 },
      4: { halign: 'right', cellWidth: 65 },
      5: { halign: 'right', cellWidth: 60 },
      6: { halign: 'right', cellWidth: 60 },
      7: { halign: 'right', cellWidth: 60 },
      8: { halign: 'right', cellWidth: 50 },
    },
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  });

  doc.setFontSize(8); doc.setTextColor(120, 120, 120);
  doc.text(`Generado ${fmt.dateTime(new Date().toISOString())} · ${rows.length} equipo(s) · ${grupo} · Mineral Group Guayana C.A.`, MARGIN, doc.internal.pageSize.getHeight() - 16);

  previewPdf(doc, `mantenimiento-${grupo.toLowerCase().replace(/\s+/g, '-')}.pdf`);
}

/* ───────── Movimientos / consumos de UN equipo (timeline por fechas) ───────── */

export interface MovimientoEquipoRow {
  fecha: string;       // ISO o yyyy-mm-dd
  origen: string;      // 'Bitácora' | 'Servicio'
  tipo: string;        // etiqueta del tipo / código del servicio
  detalle: string;     // qué se consumió/hizo (ej. "Cambio de cauchos ×6")
  /** Repuesto del inventario que llevó, «sin repuesto» si se declaró que no lleva,
   *  o «sin declarar» cuando nadie contestó la pregunta. */
  repuesto?: string;
}

/**
 * PDF del historial de movimientos/consumos de un equipo en un rango de fechas:
 * qué se hizo y cuándo (ej. "25/06 · Cambio de cauchos ×6"). Une la bitácora y las
 * solicitudes de servicio del equipo.
 */
export async function descargarMovimientosEquipoPdf(
  equipo: string,
  rows: MovimientoEquipoRow[],
  rango: { desde: string; hasta: string },
): Promise<void> {
  const [{ jsPDF }, { default: autoTable }, fmt, { loadLogoPdfDataUrl }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('@/shared/lib/format'),
    import('@/shared/lib/pdfLogo'),
  ]);
  const logo = await loadLogoPdfDataUrl().catch(() => null);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  const W = doc.internal.pageSize.getWidth();
  const MARGIN = 56.69; // 2 cm por lado
  let y = MARGIN;
  if (logo) { dibujarLogoPdf(doc, logo, MARGIN, y, 44); }

  doc.setTextColor(255, 138, 0); doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  doc.text('HISTORIAL DE MANTENIMIENTO', W / 2 + 28, y + 18, { align: 'center' });
  doc.setFontSize(11); doc.setTextColor(60, 60, 60);
  doc.text(equipo, W / 2 + 28, y + 36, { align: 'center' });
  doc.setTextColor(0, 0, 0);
  y += 56;

  const rangoTxt = rango.desde || rango.hasta
    ? `Período: ${rango.desde ? fmt.date(rango.desde) : '…'} — ${rango.hasta ? fmt.date(rango.hasta) : 'hoy'}`
    : 'Período: todo el histórico';
  doc.setFontSize(9); doc.setTextColor(90, 90, 90);
  doc.text(rangoTxt, MARGIN, y); y += 14;
  doc.setTextColor(0, 0, 0);

  const body = rows.map((r) => [fmt.date(r.fecha), r.origen, r.tipo, r.detalle, r.repuesto ?? '—']);

  autoTable(doc, {
    startY: y,
    head: [['FECHA', 'ORIGEN', 'TIPO', 'DETALLE / CONSUMO', 'REPUESTO']],
    body: body.length ? body : [['—', '—', '—', 'Sin movimientos en el período.', '—']],
    styles: { fontSize: 8.5, cellPadding: 4, valign: 'middle', overflow: 'linebreak' },
    headStyles: { fillColor: [210, 210, 210], textColor: [20, 20, 20], fontStyle: 'bold', halign: 'center' },
    columnStyles: {
      0: { cellWidth: 70 },
      1: { cellWidth: 70 },
      2: { cellWidth: 130 },
      3: { cellWidth: 'auto' },
    },
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  });

  doc.setFontSize(8); doc.setTextColor(120, 120, 120);
  doc.text(`Generado ${fmt.dateTime(new Date().toISOString())} · ${rows.length} movimiento(s) · ${equipo} · Mineral Group Guayana C.A.`, MARGIN, doc.internal.pageSize.getHeight() - 16);

  previewPdf(doc, `movimientos-${equipo.toLowerCase().replace(/\s+/g, '-')}.pdf`);
}
