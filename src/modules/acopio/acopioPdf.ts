/* ============================================================
   Golden Touch · Centro de Acopio PERAMANAL
   Reporte PDF "Control de Recepción de Mineral por Centro de Acopio".
   Réplica del formato Excel original. Se descarga SOLO al hacer clic.
   ============================================================ */
import type { RecepcionAcopio } from '@/shared/lib/types';
import { totalesRecepcion } from './acopio.repository';

const ESTADO_LABEL: Record<string, string> = {
  abierta: 'Abierta', cerrada: 'Cerrada', anulada: 'Anulada',
};

async function construir(r: RecepcionAcopio) {
  const [{ jsPDF }, { default: autoTable }, fmt, { loadLogoDataUrl }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('@/shared/lib/format'),
    import('@/shared/lib/pdfLogo'),
  ]);
  const logo = await loadLogoDataUrl().catch(() => null);
  // Apaisado: la tabla tiene muchas columnas (igual que el Excel).
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  const W = doc.internal.pageSize.getWidth();
  const MARGIN = 32;
  let y = MARGIN;

  if (logo) { try { doc.addImage(logo, 'JPEG', MARGIN, y, 46, 46); } catch { /* opcional */ } }
  const tx = logo ? MARGIN + 58 : MARGIN;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  doc.text('Control de Recepción de Mineral por Centro de Acopio', tx, y + 16);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
  doc.text(`${r.numero} · GOLDEN TOUCH 1127 C.A. · Estado: ${ESTADO_LABEL[r.estado] ?? r.estado}`, tx, y + 32);
  doc.text(`Generado ${fmt.dateTime(new Date().toISOString())}`, tx, y + 45);
  y += 60;

  doc.setDrawColor(255, 138, 0); doc.setLineWidth(1.5);
  doc.line(MARGIN, y, W - MARGIN, y);
  y += 12;

  // Encabezado (Fecha / Centro de Acopio / Aliado).
  autoTable(doc, {
    startY: y,
    body: [[
      `Fecha:  ${fmt.date(r.fecha)}`,
      `Centro de Acopio:  ${r.centro_acopio || '—'}`,
      `Aliado:  ${r.aliado || '—'}`,
    ]],
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 3 },
    margin: { left: MARGIN, right: MARGIN },
  });
  // @ts-expect-error lastAutoTable lo añade el plugin.
  y = (doc.lastAutoTable?.finalY ?? y) + 6;

  const lotes = [...(r.lotes ?? [])].sort((a, b) => a.orden - b.orden);
  const t = totalesRecepcion(lotes);

  autoTable(doc, {
    startY: y,
    head: [[
      'N° Lote', 'Bolsas', 'Peso/Bolsa', 'P. Bruto', 'P. Neto',
      'Dif. (B-N)', 'Precinto ini.', 'P. Recep.', 'Dif. (N-R)', 'Precinto fin.', 'Verf.',
    ]],
    body: lotes.map((l) => [
      l.nro_lote ?? '',
      fmt.num(l.cantidad_bolsas),
      fmt.num(l.peso_bolsa_kg),
      fmt.num(l.peso_bruto_total),
      fmt.num(l.peso_neto_kg),
      fmt.num(l.dif_bruto_neto),
      l.precinto_inicio ?? '',
      fmt.num(l.peso_recepcionado_kg),
      fmt.num(l.dif_neto_recepcionado),
      l.precinto_final ?? '',
      // Verf. = IF(precinto_inicio = precinto_final, 'V', 'F') — solo en filas con datos.
      (l.cantidad_bolsas || l.peso_neto_kg || l.precinto_inicio || l.peso_recepcionado_kg) ? (l.verificado ? 'V' : 'F') : '',
    ]),
    foot: [[
      'TOTALES', fmt.num(t.bolsas), '', fmt.num(t.bruto), fmt.num(t.neto),
      '', '', fmt.num(t.recepcionado), '', '', '',
    ]],
    theme: 'grid',
    headStyles: { fillColor: [255, 138, 0], textColor: 255, fontSize: 8.5, halign: 'center' },
    footStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: 'bold', fontSize: 8.5 },
    styles: { fontSize: 8.5, cellPadding: 3 },
    columnStyles: {
      1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' },
      5: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' }, 10: { halign: 'center' },
    },
    margin: { left: MARGIN, right: MARGIN },
  });
  // @ts-expect-error lastAutoTable lo añade el plugin.
  y = (doc.lastAutoTable?.finalY ?? y) + 24;

  // Firmas (Conforme Entregado / Conforme Recibido).
  const colW = (W - MARGIN * 2 - 24) / 2;
  const firma = (x: number, titulo: string, nombre?: string | null, ci?: string | null) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
    doc.text(titulo, x, y);
    doc.setFont('helvetica', 'normal');
    doc.text(`Nombres y Apellidos: ${nombre || '____________________'}`, x, y + 18);
    doc.text(`N° C.I.: ${ci || '____________________'}`, x, y + 34);
    doc.text('Firma: ____________________', x, y + 50);
  };
  firma(MARGIN, 'Conforme Entregado', r.entregado_nombre, r.entregado_ci);
  firma(MARGIN + colW + 24, 'Conforme Recibido por GOLDEN TOUCH 1127 C.A.', r.recibido_nombre, r.recibido_ci);

  if (r.observaciones) {
    doc.setFontSize(8.5); doc.setTextColor(90);
    doc.text(`Observaciones: ${r.observaciones}`, MARGIN, y + 72);
    doc.setTextColor(0);
  }

  return { doc, filename: `recepcion-acopio-${r.numero}.pdf` };
}

export async function descargarRecepcionPdf(r: RecepcionAcopio): Promise<void> {
  const { doc, filename } = await construir(r);
  doc.save(filename);
}
