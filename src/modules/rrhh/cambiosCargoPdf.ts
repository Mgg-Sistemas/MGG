/* ============================================================
   MGG · RRHH · Histórico de cambios de cargo · PDF (04-11-2026)

   Mismo formato que el histórico salarial: logo, título, subtítulo y la tabla
   (fecha, persona, cédula, cargo anterior y nuevo, departamento, motivo y
   quién lo registró). Para UNA persona (desde su ficha) o para TODO el
   personal. Solo por botón y en vista previa.
   ============================================================ */
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import { textoPdf } from '@/shared/lib/textoPdf';
import { MARGEN_PDF, MARGENES_TABLA_PDF, anchoUtilPdf, limiteInferiorPdf } from '@/shared/lib/pdfMargen';
import { CABECERA_CAMBIOS_CARGO, celdasCambioCargo, type FilaReporteCargo } from './cambiosCargo';

const EMPRESA = 'MINERAL GROUP GUAYANA C.A.';
const hoyTxt = () => new Date().toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const slug = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

export async function verCambiosCargoPdf(filas: FilaReporteCargo[], o: { titulo: string; subtitulo: string }): Promise<void> {
  const [{ jsPDF }, { default: autoTable }, { loadLogoDataUrl }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('@/shared/lib/pdfLogo'),
  ]);
  const logo = await loadLogoDataUrl().catch(() => null);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();

  let y = MARGEN_PDF;
  const LOGO = 58;
  if (logo) { try { doc.addImage(logo, 'JPEG', MARGEN_PDF, y, LOGO, LOGO); } catch { /* el logo es opcional */ } }
  const tx = logo ? MARGEN_PDF + LOGO + 16 : MARGEN_PDF;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(150, 90, 0);
  doc.text(EMPRESA, tx, y + 14);
  doc.setTextColor(20); doc.setFontSize(16);
  doc.text(textoPdf(o.titulo), tx, y + 36);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(90);
  doc.text(textoPdf(`${o.subtitulo} · ${filas.length} cambio(s) de cargo · emitido el ${hoyTxt()}`), tx, y + 54);
  doc.setTextColor(0);
  y += LOGO + 14;
  doc.setDrawColor(255, 138, 0); doc.setLineWidth(1.5);
  doc.line(MARGEN_PDF, y, W - MARGEN_PDF, y);
  y += 18;

  const pesos = [8, 15, 9, 13, 13, 13, 21, 12];
  const total = pesos.reduce((a, b) => a + b, 0);
  const util = anchoUtilPdf(W);
  const columnStyles: Record<number, { cellWidth: number; halign?: 'center' }> = {};
  pesos.forEach((p, i) => { columnStyles[i] = { cellWidth: util * (p / total), ...(i === 0 ? { halign: 'center' as const } : {}) }; });

  autoTable(doc, {
    startY: y,
    head: [CABECERA_CAMBIOS_CARGO.map(textoPdf)],
    body: filas.map((f) => celdasCambioCargo(f).map(textoPdf)),
    theme: 'grid',
    headStyles: { fillColor: [255, 138, 0], textColor: 255, fontStyle: 'bold', fontSize: 8, halign: 'center', valign: 'middle', lineColor: [60, 60, 60], lineWidth: 0.75 },
    styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak', valign: 'middle', lineColor: [60, 60, 60], lineWidth: 0.75, textColor: 20 },
    alternateRowStyles: { fillColor: [246, 246, 246] },
    columnStyles,
    margin: { ...MARGENES_TABLA_PDF, bottom: MARGEN_PDF + 14 },
    didParseCell: (d) => {
      // El cargo nuevo resaltado: es lo que se busca de un vistazo.
      if (d.section === 'body' && d.column.index === 4) d.cell.styles.fontStyle = 'bold';
    },
    didDrawPage: () => {
      const n = doc.getNumberOfPages();
      doc.setFontSize(8); doc.setTextColor(120);
      doc.text(textoPdf('Histórico de cambios de cargo · cada renglón es un cambio con su fecha y su motivo.'), MARGEN_PDF, limiteInferiorPdf(H));
      doc.text(`Página ${n}`, W - MARGEN_PDF, limiteInferiorPdf(H), { align: 'right' });
      doc.setTextColor(0);
    },
  });
  if (!filas.length) {
    doc.setFontSize(10); doc.setTextColor(120);
    doc.text(textoPdf('Sin cambios de cargo registrados.'), MARGEN_PDF, y + 30);
  }
  previewPdfDoc(doc, `${slug(o.titulo)}-${new Date().toISOString().slice(0, 10)}.pdf`);
}
