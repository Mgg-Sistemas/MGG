/* ============================================================
   MGG · Combustible · Reporte PDF de solicitud de salida.
   Se descarga / envía SOLO al hacer clic (regla del sistema).
   ============================================================ */
import type { SolicitudCombustible } from '@/shared/lib/types';

const ESTADO_LABEL: Record<string, string> = {
  por_aprobar: 'Por aprobar',
  aprobada: 'Aprobada',
  finalizada: 'Finalizada',
  cancelada: 'Cancelada',
};

async function construir(s: SolicitudCombustible) {
  const [{ jsPDF }, { default: autoTable }, fmt, { loadLogoDataUrl }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('@/shared/lib/format'),
    import('@/shared/lib/pdfLogo'),
  ]);
  const logo = await loadLogoDataUrl().catch(() => null);
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const MARGIN = 42.52; // 1,5 cm (margen uniforme en todos los lados)
  let y = MARGIN;
  if (logo) { try { doc.addImage(logo, 'JPEG', MARGIN, y, 50, 50); } catch { /* opcional */ } }
  const tx = logo ? MARGIN + 64 : MARGIN;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
  doc.text('Solicitud de Salida de Combustible', tx, y + 18);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text(`${s.codigo} · Mineral Group Guayana C.A.`, tx, y + 36);
  doc.text(`Generado ${fmt.dateTime(new Date().toISOString())}`, tx, y + 50);
  y += 70;

  doc.setDrawColor(255, 138, 0); doc.setLineWidth(1.5);
  doc.line(MARGIN, y, doc.internal.pageSize.getWidth() - MARGIN, y);
  y += 14;

  const ficha: Array<[string, string]> = [
    ['Combustible', s.combustible_nombre],
    ['Quién solicita', s.solicitante],
    ['Almacén de origen', s.almacen || '—'],
    ['A dónde va', s.destino],
    ['Total de litros solicitados', `${fmt.num(s.litros)} L`],
    ['Estado', ESTADO_LABEL[s.estado] ?? s.estado],
    ['Motivo / detalle', s.motivo || '—'],
    ['Creada', fmt.dateTime(s.created_at)],
    ['Aprobada', s.aprobada_en ? `${fmt.dateTime(s.aprobada_en)} · ${s.aprobada_por ?? ''}`.trim() : '—'],
    ['Finalizada', s.finalizada_en ? `${fmt.dateTime(s.finalizada_en)} · ${s.finalizada_por ?? ''}`.trim() : '—'],
    ['Registró', s.actor_name || s.actor || '—'],
  ];
  autoTable(doc, {
    startY: y, body: ficha, theme: 'plain',
    styles: { fontSize: 10, cellPadding: 4 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 200 }, 1: { cellWidth: 'auto' } },
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  });

  return { doc, filename: `solicitud-combustible-${s.codigo}.pdf` };
}

export async function descargarSolicitudCombustiblePdf(s: SolicitudCombustible): Promise<void> {
  const { doc, filename } = await construir(s);
  doc.save(filename);
}

export async function obtenerSolicitudCombustiblePdfBase64(s: SolicitudCombustible): Promise<{ base64: string; filename: string }> {
  const { doc, filename } = await construir(s);
  const dataUri = doc.output('datauristring');
  return { base64: dataUri.split(',')[1] ?? '', filename };
}
