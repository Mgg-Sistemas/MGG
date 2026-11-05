/* ============================================================
   MGG · Cocina · PDF del histórico de distribución (05-11-2026)
   Un reparto o varios: cabecera de cada uno (traslado, mercado, de → a, fecha,
   quién y estado) y la tabla de sus víveres. Solo en vista previa, por botón.
   ============================================================ */
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import { filaPdf, textoPdf } from '@/shared/lib/textoPdf';
import { MARGEN_PDF, MARGENES_TABLA_PDF, anchoUtilPdf, limiteInferiorPdf } from '@/shared/lib/pdfMargen';
import { identidadEmpresa } from '@/shared/lib/empresa';
import { etiquetaEstadoReparto, fechaHoraReparto, valorReparto, type RepartoHist } from './repartoHistorico';

const num = (n: number) => (Number(n) || 0).toLocaleString('es-VE', { maximumFractionDigits: 3 });
const usd = (n: number) => `$ ${(Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dia = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');

export async function verHistoricoRepartosPdf(rs: RepartoHist[], cab: { desde?: string; hasta?: string; cocina?: string | null }): Promise<void> {
  const [{ jsPDF }, { default: autoTable }, { loadLogoDataUrl }] = await Promise.all([
    import('jspdf'), import('jspdf-autotable'), import('@/shared/lib/pdfLogo'),
  ]);
  const logo = await loadLogoDataUrl().catch(() => null);
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const MARGIN = MARGEN_PDF;
  const ANCHO = anchoUtilPdf(W);
  const LIMITE = limiteInferiorPdf(doc.internal.pageSize.getHeight());
  let y = MARGIN;
  if (logo) { try { doc.addImage(logo, 'JPEG', MARGIN, y, 44, 44); } catch { /* opcional */ } }

  const uno = rs.length === 1;
  doc.setTextColor(255, 138, 0); doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text(textoPdf(uno ? 'DISTRIBUCIÓN DE VÍVERES' : 'HISTÓRICO DE DISTRIBUCIÓN'), W / 2, y + 18, { align: 'center' });
  doc.setTextColor(40, 40, 40); doc.setFontSize(10.5);
  doc.text(textoPdf(identidadEmpresa().nombre), W / 2, y + 34, { align: 'center' });
  doc.setTextColor(90, 90, 90); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  const sub = [
    cab.cocina ? `Cocina: ${cab.cocina}` : 'Todas las cocinas y el resguardo',
    !uno && cab.desde && cab.hasta ? `del ${dia(cab.desde)} al ${dia(cab.hasta)}` : null,
  ].filter(Boolean).join(' · ');
  doc.text(textoPdf(sub), W / 2, y + 48, { align: 'center' });
  y += 66;

  if (!uno) {
    const total = rs.reduce((a, r) => a + valorReparto(r), 0);
    doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
    doc.text(textoPdf(`Repartos: ${rs.length}   ·   Víveres enviados: ${rs.reduce((a, r) => a + r.lineas.length, 0)}   ·   Valor total: ${usd(total)}`), MARGIN, y);
    y += 14;
  }
  if (!rs.length) {
    doc.setFont('helvetica', 'normal'); doc.text(textoPdf('Sin repartos en ese período.'), MARGIN, y + 6);
  }

  for (const r of rs) {
    if (y > LIMITE - 90) { doc.addPage(); y = MARGIN; }
    doc.setFillColor(255, 244, 230); doc.rect(MARGIN, y, ANCHO, 40, 'F');
    doc.setTextColor(20, 20, 20); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    // «a» en vez de la flecha: la helvetica de jsPDF no la tiene.
    doc.text(textoPdf(`${r.codigo}  ·  ${r.origen} a ${r.destino}${r.mercado != null ? `  ·  Mercado #${r.mercado}` : ''}`), MARGIN + 6, y + 14, { maxWidth: ANCHO - 12 });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(70, 70, 70);
    doc.text(textoPdf([
      fechaHoraReparto(r.fecha), r.quien ? `Registró: ${r.quien}` : null, `Estado: ${etiquetaEstadoReparto(r.estado)}`,
      r.nota ? `Nota: ${r.nota}` : null,
    ].filter(Boolean).join('   ·   ')), MARGIN + 6, y + 30, { maxWidth: ANCHO - 12 });
    y += 44;
    const v = valorReparto(r);
    autoTable(doc, {
      startY: y,
      head: [filaPdf(['VÍVER', 'CANTIDAD', 'UNIDAD', 'COSTO UNIT.', 'VALOR'])],
      body: r.lineas.map((l) => filaPdf([
        l.nombre, num(l.cantidad), l.unidad ?? '—',
        l.precio != null ? usd(l.precio) : '—', l.precio != null ? usd((Number(l.cantidad) || 0) * l.precio) : '—',
      ])),
      foot: v > 0 ? [filaPdf(['TOTAL', '', '', '', usd(v)])] : undefined,
      styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak' },
      headStyles: { fillColor: [210, 210, 210], textColor: [20, 20, 20], fontStyle: 'bold' },
      footStyles: { fillColor: [245, 245, 245], textColor: [20, 20, 20], fontStyle: 'bold' },
      columnStyles: { 1: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right', fontStyle: 'bold' } },
      margin: MARGENES_TABLA_PDF,
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 18;
  }

  await previewPdfDoc(doc, uno ? `distribucion-${rs[0].codigo}.pdf` : `historico-distribucion-${cab.desde ?? ''}-${cab.hasta ?? ''}.pdf`);
}
