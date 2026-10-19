/* ============================================================
   MGG · Compras · Reporte por renglones (PDF)
   Un renglón por TIPO de compra pendiente:
     PENDIENTE POR APROBAR · CUENTAS A CRÉDITO ·
     POR INDICAR MÉTODO DE PAGO · POR PAGAR
   Cada fila con su CÓDIGO, su MOTIVO y su MONTO en $ o Bs.
   Las cuentas a crédito muestran además lo ABONADO y el SALDO
   pendiente. Mismos estilos que el resto de los reportes del
   sistema (logo, membrete, 2 cm de margen, pie «Página X de Y»).
   Dos salidas con la MISMA data: vista previa (📄) e impresión por
   sistema (🖨, la orden va embebida en el PDF).
   ============================================================ */
import { previewPdfDoc, imprimirPdfDoc } from '@/shared/lib/reportPreview';
import { MARGEN_PDF, MARGENES_TABLA_PDF, anchoUtilPdf, limiteInferiorPdf } from '@/shared/lib/pdfMargen';
import { agruparReporte, fmtMonto, totalesPorMoneda, totalesTexto, type FilaReporteCompras } from './comprasReporte';

/** El color de la pantalla (#rrggbb) en el formato de jsPDF. */
function hexRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return [120, 120, 120];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

/** Arma el documento una sola vez: vista previa e impresión salen de acá. */
async function construir(filas: FilaReporteCompras[]): Promise<{ doc: import('jspdf').jsPDF; filename: string }> {
  const [{ jsPDF }, { default: autoTable }, fmt, { loadLogoDataUrl }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('@/shared/lib/format'),
    import('@/shared/lib/pdfLogo'),
  ]);
  const grupos = agruparReporte(filas).filter((g) => g.filas.length > 0);
  const logo = await loadLogoDataUrl().catch(() => null);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const CW = anchoUtilPdf(W);
  let y = MARGEN_PDF;

  if (logo) { try { doc.addImage(logo, 'JPEG', MARGEN_PDF, y, 44, 44); } catch { /* opcional */ } }
  doc.setTextColor(255, 138, 0); doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  doc.text('REPORTE DE COMPRAS · POR RENGLÓN', W / 2 + 28, y + 20, { align: 'center' });
  doc.setTextColor(120, 120, 120); doc.setFontSize(9); doc.setFont('helvetica', 'normal');
  doc.text(`Pendiente por aprobar · Cuentas a crédito · Por indicar método de pago · Por pagar — ${fmt.dateTime(new Date().toISOString())}`, W / 2 + 28, y + 36, { align: 'center' });
  doc.setTextColor(0, 0, 0);
  y += 58;

  // Anchos fijos que suman EXACTO el ancho útil (tabla de margen a margen).
  const wNum = 26, wCod = 92, wTipo = 84, wMonto = 104, wAbon = 96, wSaldo = 104;

  for (const g of grupos) {
    const esCredito = g.key === 'cuenta_abierta';
    const fijas = wNum + wCod + wTipo + (esCredito ? wAbon + wSaldo : wMonto);
    const wMotivo = Math.max(120, CW - fijas);
    const cols = esCredito
      ? ['#', 'CÓDIGO', 'TIPO', 'MOTIVO', 'ABONADO', 'SALDO']
      : ['#', 'CÓDIGO', 'TIPO', 'MOTIVO', 'MONTO'];
    const cuerpo = g.filas.map((f, i) => esCredito
      ? [String(i + 1), f.codigo, f.tipo, f.motivo, fmtMonto(f.abonado, f.moneda), fmtMonto(f.saldo, f.moneda)]
      : [String(i + 1), f.codigo, f.tipo, f.motivo, fmtMonto(f.monto, f.moneda)]);
    const colStyles: Record<number, object> = {
      0: { halign: 'center', cellWidth: wNum },
      1: { halign: 'center', cellWidth: wCod },
      2: { halign: 'center', cellWidth: wTipo, fontSize: 8 },
      3: { cellWidth: wMotivo },
      ...(esCredito
        ? { 4: { halign: 'right', cellWidth: wAbon }, 5: { halign: 'right', cellWidth: wSaldo, fontStyle: 'bold' } }
        : { 4: { halign: 'right', cellWidth: wMonto, fontStyle: 'bold' } }),
    };

    autoTable(doc, {
      startY: y,
      head: [
        [{ content: `${g.titulo} · ${g.filas.length} renglón(es)`, colSpan: cols.length, styles: { fillColor: hexRgb(g.color), textColor: [255, 255, 255], fontStyle: 'bold', halign: 'left', fontSize: 10 } }],
        cols,
      ],
      body: cuerpo,
      foot: [[{ content: `TOTAL ${g.titulo}`, colSpan: cols.length - 1, styles: { halign: 'right' } }, totalesTexto(g)]],
      styles: { fontSize: 8.5, cellPadding: 4, valign: 'middle', overflow: 'linebreak' },
      headStyles: { fillColor: [225, 225, 225], textColor: [20, 20, 20], fontStyle: 'bold', halign: 'center' },
      footStyles: { fillColor: hexRgb(g.color), textColor: [255, 255, 255], fontStyle: 'bold', halign: 'right', fontSize: 9 },
      tableWidth: CW,
      columnStyles: colStyles,
      margin: { ...MARGENES_TABLA_PDF, bottom: MARGEN_PDF + 40 },
    });
    // @ts-expect-error jspdf-autotable agrega lastAutoTable en runtime
    y = (doc.lastAutoTable?.finalY ?? y) + 16;
  }

  if (grupos.length === 0) {
    doc.setFontSize(11);
    doc.text('No hay compras pendientes en este momento.', MARGEN_PDF, y + 10);
  }

  // ── TOTAL GENERAL ── (lo que suman los cuatro renglones, por moneda)
  const { usd, bs } = totalesPorMoneda(filas);
  if (grupos.length > 0) {
    const boxH = 56;
    if (y + boxH > limiteInferiorPdf(H) - 14) { doc.addPage(); y = MARGEN_PDF; }
    doc.setFillColor(255, 138, 0);
    doc.rect(MARGEN_PDF, y, CW, boxH, 'F');
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold');
    doc.setFontSize(13); doc.text('TOTAL GENERAL', MARGEN_PDF + 16, y + 24);
    doc.setFontSize(9); doc.setFont('helvetica', 'normal');
    doc.text('Suma de los cuatro renglones (en crédito, el saldo pendiente) · en la moneda de cada compra', MARGEN_PDF + 16, y + 42);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
    doc.text(`${fmtMonto(usd, 'USD')}   ·   ${fmtMonto(bs, 'Bs')}`, MARGEN_PDF + CW - 16, y + 30, { align: 'right' });
    doc.setTextColor(0, 0, 0);
  }

  // ── Pie del sistema en TODAS las páginas: fecha a la izquierda, «Página X de Y» a la derecha.
  const paginas = doc.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i);
    doc.setFontSize(8); doc.setTextColor(120, 120, 120); doc.setFont('helvetica', 'normal');
    doc.text(`Generado ${fmt.dateTime(new Date().toISOString())} · ${filas.length} renglón(es) · Mineral Group Guayana C.A.`, MARGEN_PDF, limiteInferiorPdf(H));
    doc.text(`Página ${i} de ${paginas}`, W - MARGEN_PDF, limiteInferiorPdf(H), { align: 'right' });
  }
  doc.setTextColor(0, 0, 0);

  return { doc, filename: 'reporte-compras-por-renglon.pdf' };
}

/** 📄 Vista previa del reporte (nada se descarga solo). */
export async function descargarReporteComprasPdf(filas: FilaReporteCompras[]): Promise<void> {
  const { doc, filename } = await construir(filas);
  previewPdfDoc(doc, filename);
}

/** 🖨 Impresión por sistema: manda el PDF a la impresora (orden de impresión embebida). */
export async function imprimirReporteComprasPdf(filas: FilaReporteCompras[]): Promise<void> {
  const { doc } = await construir(filas);
  imprimirPdfDoc(doc);
}
