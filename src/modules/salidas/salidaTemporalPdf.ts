/* ============================================================
   MGG · Salidas Temporales · Orden PDF (vista previa)
   Orden de salida temporal a mantenimiento (formato formal con
   firma del aprobador: Leidys Rengel o Jesús Lozada). Muestra los
   materiales, el responsable y —al finalizar— los tiempos que el
   material estuvo en mantenimiento y en tránsito.
   Se genera SOLO al hacer clic (regla del sistema).
   ============================================================ */
import type { SalidaTemporal } from '@/shared/lib/types';
import { cargarPersonasPorEmail, personaDe } from '@/shared/lib/personas';
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import { duracionesSalidaTemporal, fmtDuracion } from './salidasTemporales.repository';

const EST_TXT: Record<string, string> = {
  por_aprobar: 'Por aprobar',
  aprobada: 'Aprobada (en mantenimiento)',
  en_transito: 'En tránsito (de regreso)',
  finalizada: 'Finalizada (retornó al inventario)',
};

export async function descargarOrdenSalidaTemporalPdf(sol: SalidaTemporal): Promise<void> {
  const [{ jsPDF }, { default: autoTable }, fmt, pdfLogo, personas] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('@/shared/lib/format'),
    import('@/shared/lib/pdfLogo'),
    cargarPersonasPorEmail().catch(() => new Map<string, string>()),
  ]);
  const logo = await pdfLogo.loadLogoDataUrl().catch(() => null);
  // Firma del aprobador: Jesús Lozada = firma del Gerente (firma.png); Leidys = firma de Salidas (firma2.jpeg).
  const firma = sol.aprobada_en
    ? await (sol.aprobador_firma === 'jesus'
        ? pdfLogo.loadFirmaGerenteDataUrl()
        : pdfLogo.loadFirmaSalidasDataUrl()).catch(() => null)
    : null;

  const creo = personaDe(sol.actor, personas, sol.actor_name || sol.solicitante);
  const aprobador = sol.aprobador || '';
  const lineas = sol.items ?? [];
  const totalGeneral = lineas.reduce((a, it) => a + (Number(it.precio_unit) || 0) * (Number(it.cantidad) || 0), 0);
  const conValor = totalGeneral > 0;
  const { mant, tran, total } = duracionesSalidaTemporal(sol);

  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const PAGE_W = doc.internal.pageSize.getWidth();
  const PAGE_H = doc.internal.pageSize.getHeight();
  const MARGIN = 42.52; // 1,5 cm
  let y = MARGIN;

  // ── Encabezado ──
  const LOGO = 60;
  const TX = logo ? MARGIN + LOGO + 14 : MARGIN;
  if (logo) { try { doc.addImage(logo, 'JPEG', MARGIN, y, LOGO, LOGO); } catch { /* opcional */ } }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(19);
  doc.text('ORDEN DE SALIDA TEMPORAL', TX, y + 20);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text(`N° ${sol.num_usuario != null ? String(sol.num_usuario).padStart(3, '0') : sol.codigo}${sol.actor_name ? ` · ${sol.actor_name}` : ''}  ·  Material a mantenimiento  ·  ${sol.codigo}`, TX, y + 38);
  doc.text(`Emitida: ${fmt.dateTime(new Date().toISOString())}`, PAGE_W - MARGIN, y + 38, { align: 'right' });
  y += Math.max(LOGO, 42) + 8;

  doc.setDrawColor(255, 138, 0); doc.setLineWidth(1.5);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 18;
  doc.setLineWidth(0.5); doc.setDrawColor(180);

  // ── Emisor (izq.) + Datos (der.) ──
  const colDatosX = MARGIN + (PAGE_W - MARGIN * 2) * 0.5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text('Mineral Group Guayana C.A.', MARGIN, y);
  doc.text('Sistema de Gestión de Inventarios', MARGIN, y + 12);

  const datos: Array<[string, string]> = [
    ['Solicitante', sol.solicitante || creo || '—'],
    ...(sol.unidad_solicitante ? [['Unidad solicitante', sol.unidad_solicitante] as [string, string]] : []),
    ...(sol.responsable ? [['Responsable', `${sol.responsable}${sol.responsable_cedula ? ` · C.I. ${sol.responsable_cedula}` : ''}`] as [string, string]] : []),
    ['Fecha de solicitud', fmt.dateTime(sol.created_at)],
    ['Estado', EST_TXT[sol.estado] ?? sol.estado],
    ['Aprobado por', aprobador ? aprobador.toUpperCase() : '— (pendiente de aprobación) —'],
  ];
  let dy = y;
  doc.setFontSize(9);
  const valX = colDatosX + 108;
  const valW = PAGE_W - MARGIN - valX;
  datos.forEach(([k, v]) => {
    doc.setFont('helvetica', 'bold'); doc.text(`${k}:`, colDatosX, dy);
    doc.setFont('helvetica', 'normal');
    const lines = doc.splitTextToSize(v, valW);
    doc.text(lines, valX, dy);
    dy += Math.max(13, lines.length * 11);
  });
  y = Math.max(y + 30, dy) + 6;

  // ── Tabla de materiales ──
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text('MATERIALES', MARGIN, y);
  y += 6;
  const head = conValor
    ? [['#', 'Material', 'Origen', 'Cant.', 'Precio USD', 'Total USD']]
    : [['#', 'Material', 'Origen', 'Cant.']];
  const body = lineas.map((it, i) => {
    const c = Number(it.cantidad) || 0;
    const p = Number(it.precio_unit) || 0;
    const u = it.unidad ? ` ${it.unidad}` : '';
    const nombre = `${it.producto_nombre || '—'}${it.es_nuevo ? ' (nuevo)' : ''}${it.observacion ? `\nObs: ${it.observacion}` : ''}`;
    const origen = it.es_nuevo ? 'Nuevo (fuera de inventario)' : (it.almacen || '—');
    const base = [String(i + 1), nombre, origen, `${fmt.num(c)}${u}`];
    return conValor ? [...base, p ? fmt.money(p) : '—', p ? fmt.money(p * c) : '—'] : base;
  });
  autoTable(doc, {
    startY: y, head, body, theme: 'striped',
    headStyles: { fillColor: [255, 138, 0], textColor: 255, fontStyle: 'bold', fontSize: 9.5 },
    styles: { fontSize: 9.5, cellPadding: 4 },
    columnStyles: conValor
      ? { 0: { cellWidth: 24, halign: 'right' }, 2: { cellWidth: 120 }, 3: { halign: 'right', cellWidth: 60 }, 4: { halign: 'right', cellWidth: 74 }, 5: { halign: 'right', cellWidth: 80 } }
      : { 0: { cellWidth: 24, halign: 'right' }, 2: { cellWidth: 160 }, 3: { halign: 'right', cellWidth: 80 } },
    ...(conValor ? {
      foot: [['', '', '', '', 'TOTAL', `${fmt.money(totalGeneral)} USD`]],
      footStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: 'bold', halign: 'right', fontSize: 10 },
    } : {}),
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 16;

  // ── Tiempos (solo al finalizar) ──
  if (sol.estado === 'finalizada') {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text('TIEMPOS', MARGIN, y);
    y += 14;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
    const tl = [
      `En mantenimiento (aprobada → en tránsito): ${fmtDuracion(mant)}`,
      `En tránsito (en tránsito → finalizada): ${fmtDuracion(tran)}`,
      `Total fuera del inventario: ${fmtDuracion(total)}`,
    ];
    doc.text(tl, MARGIN, y);
    y += tl.length * 12 + 4;
  }

  // ── Observaciones / Notas ──
  const obs: string[] = [];
  if (sol.direccion_despacho) obs.push(`Origen (despacho): ${sol.direccion_despacho}`);
  if (sol.direccion_destino) obs.push(`Destino (mantenimiento): ${sol.direccion_destino}`);
  if (sol.motivo) obs.push(`Motivo: ${sol.motivo}`);
  if (sol.nota) obs.push(`Nota: ${sol.nota}`);
  if (obs.length) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text('OBSERVACIONES / NOTAS', MARGIN, y);
    y += 14;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
    const wrapped = doc.splitTextToSize(obs.join('\n'), PAGE_W - MARGIN * 2);
    doc.text(wrapped, MARGIN, y);
    y += wrapped.length * 12;
  }

  // ── Firmas al pie ──
  const needTop = 52;
  const needBot = 34;
  let fy = PAGE_H - MARGIN - needBot;
  if (y + needTop > fy) {
    if (y + needTop + needBot <= PAGE_H - MARGIN) fy = y + needTop;
    else { doc.addPage(); fy = MARGIN + needTop; }
  }
  const colW = (PAGE_W - MARGIN * 2 - 40) / 2;
  const cxAprueba = MARGIN + colW + 40 + colW / 2;
  if (firma && sol.aprobada_en) {
    try {
      const sw = 150, sh = 52;
      doc.addImage(firma, sol.aprobador_firma === 'jesus' ? 'PNG' : 'JPEG', cxAprueba - sw / 2, fy - sh + 8, sw, sh);
    } catch { /* firma opcional */ }
  }
  doc.setDrawColor(120); doc.setLineWidth(0.7);
  doc.line(MARGIN, fy, MARGIN + colW, fy);
  doc.line(MARGIN + colW + 40, fy, MARGIN + colW * 2 + 40, fy);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.text('Solicitado / Creado por', MARGIN + colW / 2, fy + 14, { align: 'center' });
  doc.text('Aprobado por', cxAprueba, fy + 14, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.text(creo || '—', MARGIN + colW / 2, fy + 27, { align: 'center' });
  doc.text(aprobador || '— (pendiente) —', cxAprueba, fy + 27, { align: 'center' });

  doc.setFontSize(8); doc.setTextColor(120);
  doc.text(`Documento auto-generado · ${sol.codigo} · ${fmt.dateTime(new Date().toISOString())}`, MARGIN, PAGE_H - 24);

  previewPdfDoc(doc, `orden-salida-temporal-${sol.codigo}.pdf`);
}
