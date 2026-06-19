/* ============================================================
   MGG · Compras · PDF de la checklist "OC por lote"
   Relación de compras pendientes por pagar. Solo por botón.
   ============================================================ */
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import type { OcLoteRow } from './ocLote.repository';

async function construir(rows: OcLoteRow[], codigo: string) {
  const [{ jsPDF }, { default: autoTable }, fmt, { loadLogoDataUrl }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('@/shared/lib/format'),
    import('@/shared/lib/pdfLogo'),
  ]);
  const logo = await loadLogoDataUrl().catch(() => null);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  const W = doc.internal.pageSize.getWidth();
  const MARGIN = 42.52; // 1,5 cm (margen uniforme en todos los lados)
  let y = MARGIN;
  if (logo) { try { doc.addImage(logo, 'JPEG', MARGIN, y, 44, 44); } catch { /* opcional */ } }

  // Título (colores del sistema, sin fondo).
  doc.setTextColor(255, 138, 0); doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  doc.text('ÓRDENES DE COMPRA PENDIENTES POR CONFIRMACIÓN', W / 2 + 28, y + 26, { align: 'center' });
  doc.setTextColor(0, 0, 0);
  y += 50;

  // Unidad solicitante = depto/unidad que pide (orden.solicitante); Solicitante = la persona.
  const unidadDe = (r: OcLoteRow) => r.orden.solicitante?.trim() || '—';
  const solicitanteDe = (r: OcLoteRow) => r.orden.ci_solicitante?.trim() || r.orden.solicitante_email || '—';
  const body = rows.map((r, i) => [
    String(i + 1),
    r.orden.oc_codigo ?? r.orden.codigo,
    solicitanteDe(r),
    unidadDe(r),
    r.proveedorNombre,
    r.descripcion,
    fmt.money(r.orden.total),
    r.orden.oc_creada_en ? fmt.date(r.orden.oc_creada_en) : '—',
    r.orden.oc_aprobada_en ? fmt.date(r.orden.oc_aprobada_en) : '—',
    r.pagado ? 'CONFIRMADA' : 'PENDIENTE POR CONFIRMAR',
  ]);

  autoTable(doc, {
    startY: y,
    head: [['ITEM', 'N°ODC', 'SOLICITADO POR', 'UNIDAD / ÁREA', 'PROVEEDOR', 'DESCRIPCIÓN', 'MONTO $', 'FECHA DE COMPRA', 'FECHA DE FIRMA', 'ESTATUS']],
    body,
    styles: { fontSize: 8, cellPadding: 4, valign: 'middle' },
    headStyles: { fillColor: [210, 210, 210], textColor: [20, 20, 20], fontStyle: 'bold', halign: 'center' },
    columnStyles: {
      0: { halign: 'center', cellWidth: 32 },
      1: { halign: 'center', cellWidth: 60 },
      5: { cellWidth: 180 },
      6: { halign: 'right', cellWidth: 56 },
      9: { halign: 'center', cellWidth: 86 },
    },
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 9) {
        const confirmada = data.cell.raw === 'CONFIRMADA';
        data.cell.styles.fillColor = confirmada ? [22, 160, 90] : [200, 30, 30];
        data.cell.styles.textColor = [255, 255, 255];
        data.cell.styles.fontStyle = 'bold';
      }
    },
  });

  doc.setFontSize(8); doc.setTextColor(120, 120, 120);
  doc.text(`Generado ${fmt.dateTime(new Date().toISOString())} · Mineral Group Guayana C.A.`, MARGIN, doc.internal.pageSize.getHeight() - 16);

  return { doc, filename: `checklist-${codigo}.pdf` };
}

export async function descargarChecklistOcPdf(rows: OcLoteRow[], codigo: string): Promise<void> {
  const { doc, filename } = await construir(rows, codigo);
  previewPdfDoc(doc, filename);
}

export async function obtenerChecklistOcPdfBase64(rows: OcLoteRow[], codigo: string): Promise<string> {
  const { doc } = await construir(rows, codigo);
  return doc.output('datauristring').split(',')[1];
}
