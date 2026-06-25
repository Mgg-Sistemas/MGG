/* ============================================================
   MGG · Servicio de Mantenimiento · Resumen PDF (vista previa)
   Por equipo del grupo activo: status, horómetro, HRS restantes y
   consumos del período (aceite / gasoil / refrigerante / filtros).
   ============================================================ */
import { previewPdfDoc } from '@/shared/lib/reportPreview';

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

/** Un movimiento de la bitácora para el PDF de detalle por equipo. */
export interface MovEquipoRow {
  fecha: string;
  tipo: string | null;
  horometro: number | null;
  kilometraje: number | null;
  aceite: number | null;
  gasoil: number | null;
  refrigerante: number | null;
  filtros: number | null;
  filtrosTipo: string | null;
  /** Repuestos/insumos cambiados, ya formateados: "CAUCHOS ×6, PINTURA ×2". */
  insumos: string;
  trabajo: string | null;
  mecanico: string | null;
}

/**
 * PDF de TODOS los movimientos de un equipo en un rango de fechas: qué se consumió
 * y cuándo (ej.: "25/06/2026 · Cambio de cauchos · CAUCHOS ×6"). Vista previa.
 */
export async function descargarMovimientosEquipoPdf(
  equipo: string,
  rows: MovEquipoRow[],
  rango: { desde: string; hasta: string },
): Promise<void> {
  const [{ jsPDF }, { default: autoTable }, fmt, { loadLogoDataUrl }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('@/shared/lib/format'),
    import('@/shared/lib/pdfLogo'),
  ]);
  const logo = await loadLogoDataUrl().catch(() => null);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  const W = doc.internal.pageSize.getWidth();
  const MARGIN = 42.52;
  let y = MARGIN;
  if (logo) { try { doc.addImage(logo, 'JPEG', MARGIN, y, 44, 44); } catch { /* opcional */ } }

  doc.setTextColor(255, 138, 0); doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  doc.text('BITÁCORA DE MANTENIMIENTO', W / 2 + 28, y + 20, { align: 'center' });
  doc.setFontSize(11); doc.setTextColor(60, 60, 60);
  doc.text(equipo, W / 2 + 28, y + 38, { align: 'center' });
  doc.setTextColor(0, 0, 0);
  y += 56;

  const rangoTxt = rango.desde || rango.hasta
    ? `Período: ${rango.desde ? fmt.date(rango.desde) : '…'} — ${rango.hasta ? fmt.date(rango.hasta) : 'hoy'}`
    : 'Período: todo el histórico';
  doc.setFontSize(9); doc.setTextColor(90, 90, 90);
  doc.text(rangoTxt, MARGIN, y); y += 14;
  doc.setTextColor(0, 0, 0);

  const body = rows.map((r) => [
    fmt.date(r.fecha),
    r.tipo ?? '—',
    r.horometro != null ? n(r.horometro) : '—',
    r.kilometraje != null ? n(r.kilometraje) : '—',
    r.aceite != null ? n(r.aceite) : '—',
    r.gasoil != null ? n(r.gasoil) : '—',
    r.refrigerante != null ? n(r.refrigerante) : '—',
    r.filtros != null ? `${n(r.filtros)}${r.filtrosTipo ? ` (${r.filtrosTipo})` : ''}` : '—',
    r.insumos || '—',
    r.trabajo || r.mecanico ? [r.trabajo, r.mecanico].filter(Boolean).join(' · ') : '—',
  ]);

  autoTable(doc, {
    startY: y,
    head: [['FECHA', 'TIPO', 'HORÓM.', 'KM', 'ACEITE', 'GASOIL', 'REFRIG.', 'FILTROS', 'REPUESTOS / INSUMOS', 'TRABAJO']],
    body,
    styles: { fontSize: 7.5, cellPadding: 3, valign: 'middle', overflow: 'linebreak' },
    headStyles: { fillColor: [210, 210, 210], textColor: [20, 20, 20], fontStyle: 'bold', halign: 'center' },
    columnStyles: {
      0: { cellWidth: 58 },
      1: { cellWidth: 95 },
      2: { halign: 'right', cellWidth: 50 },
      3: { halign: 'right', cellWidth: 50 },
      4: { halign: 'right', cellWidth: 45 },
      5: { halign: 'right', cellWidth: 45 },
      6: { halign: 'right', cellWidth: 48 },
      7: { halign: 'right', cellWidth: 60 },
      8: { cellWidth: 150 },
      9: { cellWidth: 110 },
    },
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  });

  doc.setFontSize(8); doc.setTextColor(120, 120, 120);
  doc.text(`Generado ${fmt.dateTime(new Date().toISOString())} · ${rows.length} movimiento(s) · ${equipo} · Mineral Group Guayana C.A.`, MARGIN, doc.internal.pageSize.getHeight() - 16);

  previewPdfDoc(doc, `bitacora-${equipo.toLowerCase().replace(/\s+/g, '-')}.pdf`);
}

export async function descargarResumenMantenimientoPdf(
  grupo: string,
  rows: ResumenMantRow[],
  rango: { desde: string; hasta: string },
): Promise<void> {
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
      0: { halign: 'center', cellWidth: 32 },
      1: { cellWidth: 200 },
      2: { cellWidth: 95 },
      3: { halign: 'right', cellWidth: 75 },
      4: { halign: 'right', cellWidth: 70 },
      5: { halign: 'right', cellWidth: 65 },
      6: { halign: 'right', cellWidth: 65 },
      7: { halign: 'right', cellWidth: 65 },
      8: { halign: 'right', cellWidth: 55 },
    },
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  });

  doc.setFontSize(8); doc.setTextColor(120, 120, 120);
  doc.text(`Generado ${fmt.dateTime(new Date().toISOString())} · ${rows.length} equipo(s) · ${grupo} · Mineral Group Guayana C.A.`, MARGIN, doc.internal.pageSize.getHeight() - 16);

  previewPdfDoc(doc, `mantenimiento-${grupo.toLowerCase().replace(/\s+/g, '-')}.pdf`);
}
