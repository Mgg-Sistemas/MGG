/* ============================================================
   MGG · Conciliación · PDF del reporte dinámico (12-11-2026)
   Mismo membrete que Tesorería; se abre en la vista previa (previewPdf).
   ============================================================ */
import { previewPdf } from '@/shared/lib/reportePreview';
import { pdfSafe } from '@/shared/lib/pdfSafe';
import { identidadEmpresa } from '@/shared/lib/empresa';
import { loadLogoPdfEmpresa, dibujarLogoPdf, anchoLogoPdf } from '@/shared/lib/pdfLogo';
import { COLUMNAS_CONCILIACION, bsTxt, celda, tarjetas, usdTxt, type ColumnaConciliacion, type FilaConciliacion } from './conciliacion';

const NARANJA: [number, number, number] = [255, 138, 0];
const BORDE: [number, number, number] = [203, 213, 225];

export interface OpcionesPdfConciliacion {
  columnas: ColumnaConciliacion[];
  /** Resumen de los filtros aplicados (sale bajo el título). */
  filtroTexto?: string;
  conTarjetas?: boolean;
  orientacion?: 'auto' | 'portrait' | 'landscape';
}

export async function vistaPreviaConciliacionPdf(filas: FilaConciliacion[], op: OpcionesPdfConciliacion): Promise<void> {
  const cols = COLUMNAS_CONCILIACION.filter((c) => op.columnas.includes(c.clave));
  if (!cols.length) throw new Error('Selecciona al menos una columna.');
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const orient = op.orientacion === 'portrait' || op.orientacion === 'landscape' ? op.orientacion : (cols.length > 6 ? 'landscape' : 'portrait');
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: orient });
  const W = doc.internal.pageSize.getWidth();
  const M = 36;
  const UW = W - M * 2;
  let y = M;

  // Membrete
  const idEmp = identidadEmpresa('MGG');
  const logo = await loadLogoPdfEmpresa('MGG').catch(() => null);
  const caja = 40;
  if (logo) dibujarLogoPdf(doc, logo, M, y, caja);
  const tx = logo ? M + anchoLogoPdf(caja) + 12 : M;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(...NARANJA);
  doc.text(pdfSafe('CONCILIACIÓN DE ÓRDENES DE COMPRA'), tx, y + 14);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(80, 80, 80);
  const sub = doc.splitTextToSize(pdfSafe(
    `${idEmp.nombre} · RIF ${idEmp.rif} · ${filas.length} OC · Generado: ${new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' })}${op.filtroTexto ? ` · ${op.filtroTexto}` : ''}`,
  ), W - M - tx) as string[];
  doc.text(sub, tx, y + 28);
  y = Math.max(y + caja + 6, y + 28 + sub.length * 10 + 4);
  doc.setDrawColor(...NARANJA); doc.setLineWidth(1.4); doc.line(M, y, W - M, y);
  y += 14;

  // Tarjetas
  if (op.conTarjetas !== false) {
    const t = tarjetas(filas);
    const datos: Array<[string, string, string]> = [
      ['TOTAL DE OC', `${t.totalOc.cantidad} OC`, `${usdTxt(t.totalOc.usd)} · ${bsTxt(t.totalOc.bs)}`],
      ['TOTAL PAGADO', `${t.pagado.cantidad} OC`, `${usdTxt(t.pagado.usd)} · ${bsTxt(t.pagado.bs)}`],
      ['OC CON RETENCIÓN', `${t.conRetencion.cantidad} OC`, usdTxt(t.conRetencion.usd)],
    ];
    const gap = 10, w = (UW - gap * 2) / 3, h = 46;
    datos.forEach(([tit, val, sub2], i) => {
      const x = M + i * (w + gap);
      doc.setFillColor(250, 250, 250); doc.setDrawColor(...BORDE); doc.setLineWidth(0.6);
      doc.roundedRect(x, y, w, h, 4, 4, 'FD');
      doc.setFillColor(...NARANJA); doc.rect(x, y + 1, 3, h - 2, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(110, 110, 110);
      doc.text(pdfSafe(tit), x + 10, y + 13);
      doc.setFontSize(12); doc.setTextColor(30, 30, 30);
      doc.text(pdfSafe(val), x + 10, y + 28);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(90, 90, 90);
      doc.text(pdfSafe(sub2), x + 10, y + 39, { maxWidth: w - 16 });
    });
    y += h + 14;
  }

  const derecha = new Set<ColumnaConciliacion>(['monto_usd', 'monto_bs', 'tasa']);
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head: [cols.map((c) => pdfSafe(c.label.toUpperCase()))],
    body: filas.map((f) => cols.map((c) => pdfSafe(celda(f, c.clave)))),
    foot: [cols.map((c, i) => {
      if (c.clave === 'monto_usd') return usdTxt(filas.reduce((a, f) => a + f.montoUsd, 0));
      if (c.clave === 'monto_bs') return bsTxt(filas.reduce((a, f) => a + (f.montoBs ?? 0), 0));
      return i === 0 ? 'TOTAL' : '';
    })],
    styles: { fontSize: 7.5, cellPadding: 3, lineColor: BORDE, lineWidth: 0.3, textColor: [30, 30, 30] },
    headStyles: { fillColor: NARANJA, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7 },
    footStyles: { fillColor: [241, 245, 249], textColor: [30, 30, 30], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: Object.fromEntries(cols.map((c, i) => [i, derecha.has(c.clave) ? { halign: 'right' } : c.clave === 'item' ? { halign: 'center', cellWidth: 26 } : {}])),
    didDrawPage: () => {
      const H = doc.internal.pageSize.getHeight();
      doc.setFontSize(7); doc.setTextColor(140, 140, 140);
      doc.text(pdfSafe(`Conciliación · página ${doc.getNumberOfPages()}`), W - M, H - 16, { align: 'right' });
    },
  });

  const hoy = new Date().toISOString().slice(0, 10);
  previewPdf(doc, `conciliacion-oc-${hoy}.pdf`);
}
