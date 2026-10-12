/* ============================================================
   MGG · Asignaciones · Acta de entrega (PDF · vista previa)

   La MISMA carta que se firmaba desde el Drive: logo, «Puerto Ordaz, 24 de
   septiembre del 2026», «ASIGNACIÓN 026-2026», el párrafo de quién entrega
   a quién y qué, el cuadro ENTREGA / RECIBE con espacio para firma y
   huella, el pie con el domicilio fiscal y, en la hoja siguiente, el
   ANEXO FOTOGRÁFICO con las fotos del acta.

   Solo vista previa, por botón: acá nunca se descarga nada solo.
   ============================================================ */
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import { textoPdf, filaPdf } from '@/shared/lib/textoPdf';
import { MARGEN_PDF, MARGENES_TABLA_PDF, limiteInferiorPdf } from '@/shared/lib/pdfMargen';
import { loadLogoDataUrl } from '@/shared/lib/pdfLogo';
import { date as fmtDate } from '@/shared/lib/format';
import type { Asignacion, Personal } from '@/shared/lib/types';
import { labelTipo } from './asignaciones';
import {
  ITEMS_EN_TABLA, PIE_ACTA, cedulaConPuntos, fechaCartaVE, nombreCarta, parrafoActa, textoItemActa,
} from './actas';
import type { ActaAsignacion } from './actas.repository';

const GRIS: [number, number, number] = [110, 110, 110];
const TINTA: [number, number, number] = [30, 30, 30];
const AZUL: [number, number, number] = [30, 80, 160];

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Logo arriba a la izquierda y RIF debajo, como en el membrete. */
function membrete(doc: any, logo: string | null, M: number): number {
  const LOGO = 54;
  if (logo) { try { doc.addImage(logo, 'JPEG', M, M, LOGO, LOGO); } catch { /* el logo es opcional */ } }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...GRIS);
  doc.text('J-50221930-7', M + (logo ? LOGO / 2 : 0), M + LOGO + 9, { align: logo ? 'center' : 'left' });
  return M + LOGO + 26;
}

/** El pie con el domicilio fiscal, igual en todas las hojas. */
function pie(doc: any, W: number, H: number, M: number): void {
  const y = limiteInferiorPdf(H);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...TINTA);
  doc.text(textoPdf(PIE_ACTA.linea1), W / 2, y - 18, { align: 'center' });
  doc.text(textoPdf(PIE_ACTA.linea2), W / 2, y - 8, { align: 'center' });
  const [tel, correo] = PIE_ACTA.linea3.split(/\s{2,}/);
  const ancho = doc.getTextWidth(textoPdf(`${tel}   ${correo}`));
  const x0 = (W - ancho) / 2;
  doc.text(textoPdf(`${tel}   `), x0, y + 2);
  doc.setTextColor(...AZUL);
  doc.text(textoPdf(correo), x0 + doc.getTextWidth(textoPdf(`${tel}   `)), y + 2);
  doc.setTextColor(...TINTA);
  void M;
}

/**
 * El acta, lista para imprimir y firmar.
 *
 * `fotos` llegan ya como data URL (la pantalla las baja con su URL firmada):
 * si no hay ninguna, el anexo no se imprime.
 */
export async function verActaEntregaPdf(
  acta: ActaAsignacion,
  items: Asignacion[],
  recibe: Personal | null,
  fotos: { dataUrl: string; filename: string }[] = [],
): Promise<void> {
  const [{ jsPDF }, { default: autoTable }, logo] = await Promise.all([
    import('jspdf'), import('jspdf-autotable'), loadLogoDataUrl().catch(() => null),
  ]);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = MARGEN_PDF;
  const ancho = W - 2 * M;

  let y = membrete(doc, logo, M);

  // Fecha a la derecha, como en la carta.
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...TINTA);
  doc.text(textoPdf(fechaCartaVE(acta.fecha)), W - M, y, { align: 'right' });
  y += 34;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text(textoPdf(`ASIGNACIÓN ${acta.numero}`), W / 2, y, { align: 'center' });
  y += 26;

  const recibeNombre = recibe ? nombreCarta(recibe) : '—';
  const parrafo = parrafoActa({
    entregaNombre: acta.entrega_nombre ?? '', entregaCedula: acta.entrega_cedula ?? '', entregaCargo: acta.entrega_cargo ?? '',
    recibeNombre, items, observaciones: acta.observaciones,
  });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5);
  const lineas = doc.splitTextToSize(textoPdf(parrafo), ancho) as string[];
  doc.text(lineas, M, y, { align: 'justify', maxWidth: ancho, lineHeightFactor: 1.45 });
  y += lineas.length * 10.5 * 1.45 + 10;

  // Con muchos ítems, la lista va en tabla debajo del párrafo.
  if (items.length >= ITEMS_EN_TABLA) {
    autoTable(doc as any, {
      startY: y,
      head: [filaPdf(['#', 'Tipo', 'Lo entregado', 'Vuelve'])],
      body: items.map((a, i) => filaPdf([String(i + 1), labelTipo(a.tipo), textoItemActa(a), a.retornable ? 'Sí' : 'No'])),
      styles: { fontSize: 8.5, cellPadding: 3, textColor: 20, lineColor: [60, 60, 60], lineWidth: 0.5 },
      headStyles: { fillColor: [235, 235, 235], textColor: 20, fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 22, halign: 'center' }, 1: { cellWidth: 95 }, 3: { cellWidth: 46, halign: 'center' } },
      margin: MARGENES_TABLA_PDF,
      theme: 'grid',
    });
    y = ((doc as any).lastAutoTable?.finalY ?? y) + 14;
  }

  const obs = (acta.observaciones ?? '').trim();
  if (obs && (obs.length > 120 || items.length >= ITEMS_EN_TABLA)) {
    doc.setFontSize(9.5);
    const l2 = doc.splitTextToSize(textoPdf(`Observaciones: ${obs}`), ancho) as string[];
    doc.text(l2, M, y, { lineHeightFactor: 1.4 });
    y += l2.length * 9.5 * 1.4 + 8;
  }

  doc.setFontSize(10.5);
  const cierre = doc.splitTextToSize(textoPdf('Sin otro particular a que hacer referencia me despido agradeciendo su valiosa colaboración.'), ancho) as string[];
  doc.text(cierre, M, y + 6, { lineHeightFactor: 1.45 });
  y += cierre.length * 10.5 * 1.45 + 20;
  doc.text('Atentamente:', M, y);
  y += 24;

  // El cuadro ENTREGA / RECIBE: rótulo, espacio para firma y huella, nombre y cédula.
  const entregaTxt = [acta.entrega_nombre ? acta.entrega_nombre.toUpperCase() : '', acta.entrega_cedula ? `C.I. ${cedulaConPuntos(acta.entrega_cedula)}` : ''].filter(Boolean).join('\n');
  const recibeTxt = [recibeNombre, recibe?.cedula ? `C.I. ${cedulaConPuntos(recibe.cedula)}` : ''].filter(Boolean).join('\n');
  if (y + 190 > limiteInferiorPdf(H) - 40) { pie(doc, W, H, M); doc.addPage(); y = M + 10; }
  autoTable(doc as any, {
    startY: y,
    head: [filaPdf(['ENTREGA:', 'RECIBE:'])],
    body: [
      ['', ''],
      filaPdf([entregaTxt, recibeTxt]),
    ],
    styles: { fontSize: 9, cellPadding: 6, textColor: 20, lineColor: [40, 40, 40], lineWidth: 0.75, valign: 'top' },
    headStyles: { fillColor: [255, 255, 255], textColor: 20, fontStyle: 'bold', halign: 'left', minCellHeight: 22 },
    bodyStyles: { fontStyle: 'bold' },
    didParseCell: (d: any) => { if (d.section === 'body' && d.row.index === 0) d.cell.styles.minCellHeight = 96; },
    didDrawCell: (d: any) => {
      if (d.section !== 'body' || d.row.index !== 0) return;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(170, 170, 170);
      doc.text(textoPdf('Firma y huella'), d.cell.x + d.cell.width - 6, d.cell.y + d.cell.height - 6, { align: 'right' });
      doc.setTextColor(...TINTA);
    },
    margin: MARGENES_TABLA_PDF,
    theme: 'grid',
  });
  y = ((doc as any).lastAutoTable?.finalY ?? y) + 10;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...GRIS);
  doc.text(textoPdf(`Acta ${acta.numero} · entrega del ${fmtDate(acta.fecha)} · ${items.length} ítem(s) · generada por el sistema MGG`), M, y);
  pie(doc, W, H, M);

  // ── Anexo fotográfico ──
  if (fotos.length) {
    doc.addPage();
    let ya = membrete(doc, logo, M);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...TINTA);
    doc.text(textoPdf('ANEXO FOTOGRÁFICO:'), W / 2, ya + 4, { align: 'center' });
    ya += 24;
    const gap = 12;
    const col = fotos.length === 1 ? ancho : (ancho - gap) / 2;
    const altoMax = fotos.length === 1 ? 330 : 230;
    fotos.forEach((f, i) => {
      const fila = Math.floor(i / 2); const colIdx = fotos.length === 1 ? 0 : i % 2;
      const x = M + colIdx * (col + gap);
      const yy = ya + fila * (altoMax + gap + 12);
      if (yy + altoMax > limiteInferiorPdf(H) - 30) return;
      try {
        const props = doc.getImageProperties(f.dataUrl);
        const r = Math.min(col / props.width, altoMax / props.height);
        const w = props.width * r; const h = props.height * r;
        doc.addImage(f.dataUrl, props.fileType || 'JPEG', x + (col - w) / 2, yy, w, h);
      } catch { /* una foto ilegible no tumba el acta */ }
    });
    pie(doc, W, H, M);
  }

  previewPdfDoc(doc, `acta-asignacion-${acta.numero}.pdf`);
}
