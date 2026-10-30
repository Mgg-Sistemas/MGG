/* ============================================================
   MGG · Delivery · PDF (30-10-2026)
   «Histórico de Delivery» y «Pedidos por delivery». Se abren en la vista
   previa del sistema (previewPdfDoc): nada se descarga solo, el archivo sale
   únicamente con el botón Descargar del visor.
   ============================================================ */
import { loadLogoDataUrl } from '@/shared/lib/pdfLogo';
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import { MARGEN_PDF, MARGENES_TABLA_PDF, limiteInferiorPdf } from '@/shared/lib/pdfMargen';
import { pdfSafe } from '@/shared/lib/pdfSafe';
import { ESTADO_DELIVERY, fechaHoraVE, montoTxt } from './delivery';
import { duracionTxt, totalesResumen, type FilaHistorialDelivery, type ResumenDelivery } from './deliveryPanel';

const MARGIN = MARGEN_PDF;
const ALTO_PIE = 14;
const MARGENES_TABLA = { ...MARGENES_TABLA_PDF, bottom: MARGEN_PDF + ALTO_PIE };
const NARANJA: [number, number, number] = [255, 138, 0];

const fechaTxt = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
};

async function nuevoDoc(titulo: string, sub: string, apaisado: boolean) {
  const [{ jsPDF }, { default: autoTable }, logo] = await Promise.all([
    import('jspdf'), import('jspdf-autotable'), loadLogoDataUrl().catch(() => null),
  ]);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: apaisado ? 'landscape' : 'portrait' });
  const PAGE_W = doc.internal.pageSize.getWidth();
  let y = MARGIN;
  const LOGO = 56;
  const TX = logo ? MARGIN + LOGO + 14 : MARGIN;
  if (logo) { try { doc.addImage(logo, 'JPEG', MARGIN, y, LOGO, LOGO); } catch { /* opcional */ } }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text(pdfSafe(titulo), TX, y + 18);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text('Mineral Group Guayana C.A.', TX, y + 34);
  const subLineas = doc.splitTextToSize(pdfSafe(sub), PAGE_W - MARGIN - TX) as string[];
  doc.setTextColor(90); doc.text(subLineas, TX, y + 48); doc.setTextColor(0);
  y += Math.max(LOGO, 50 + (subLineas.length - 1) * 12) + 10;
  doc.setDrawColor(...NARANJA); doc.setLineWidth(1.5); doc.line(MARGIN, y, PAGE_W - MARGIN, y); y += 16;
  return { doc, autoTable, y };
}

/** Pie con el número de página en todas las hojas. */
function pies(doc: import('jspdf').jsPDF, texto: string) {
  const n = doc.getNumberOfPages();
  const h = doc.internal.pageSize.getHeight();
  const w = doc.internal.pageSize.getWidth();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFontSize(8); doc.setTextColor(120);
    doc.text(pdfSafe(texto), MARGIN, limiteInferiorPdf(h));
    doc.text(`Página ${i} de ${n}`, w - MARGIN, limiteInferiorPdf(h), { align: 'right' });
  }
  doc.setTextColor(0);
}

const rangoTxt = (desde: string, hasta: string) => (desde === hasta ? `Día ${fechaTxt(desde)}` : `Del ${fechaTxt(desde)} al ${fechaTxt(hasta)}`);

/** Histórico de Delivery en el rango (con el filtro de motorizado, si lo hay). */
export async function pdfHistorialDelivery(data: {
  desde: string; hasta: string; repartidor?: string | null; filas: FilaHistorialDelivery[];
}): Promise<void> {
  const generado = fechaHoraVE(new Date().toISOString());
  const sub = `${rangoTxt(data.desde, data.hasta)}${data.repartidor ? ` · Delivery: ${data.repartidor}` : ''} · ${data.filas.length} registro(s) · Generado ${generado}`;
  const { doc, autoTable, y } = await nuevoDoc('Histórico de Delivery', sub, true);
  autoTable(doc, {
    startY: y,
    head: [['Tomado', 'OC', 'Proveedor', 'Delivery', 'Estado', 'En ruta', 'Entregado / Cancelado', 'Tiempo', 'Almacén / Motivo', 'Monto']],
    body: data.filas.map((f) => [
      fechaHoraVE(f.fecha), f.oc, f.proveedor, f.repartidor, ESTADO_DELIVERY[f.estado]?.label ?? f.estado,
      fechaHoraVE(f.en_ruta_en) || '—',
      fechaHoraVE(f.estado === 'cancelado' ? f.cancelado_en : f.entregado_en) || '—',
      duracionTxt(f.minutos),
      (f.estado === 'cancelado' ? f.motivo_cancel : f.almacen_entrega) || '—',
      montoTxt(f.total, f.moneda),
    ].map((x) => pdfSafe(String(x)))),
    theme: 'grid',
    headStyles: { fillColor: NARANJA, textColor: 255, fontSize: 8.5 },
    styles: { fontSize: 7.8, cellPadding: 3, overflow: 'linebreak' },
    columnStyles: { 7: { halign: 'right' }, 9: { halign: 'right' } },
    margin: MARGENES_TABLA,
  });
  pies(doc, `Histórico de Delivery · ${generado}`);
  previewPdfDoc(doc, `delivery-historico-${data.desde}_${data.hasta}.pdf`);
}

/** Cuántos pedidos lleva cada delivery en el rango. */
export async function pdfPorDelivery(data: { desde: string; hasta: string; resumen: ResumenDelivery[] }): Promise<void> {
  const generado = fechaHoraVE(new Date().toISOString());
  const { doc, autoTable, y } = await nuevoDoc('Pedidos por delivery', `${rangoTxt(data.desde, data.hasta)} · Generado ${generado}`, false);
  const t = totalesResumen(data.resumen);
  autoTable(doc, {
    startY: y,
    head: [['Delivery', 'Entregados', 'Cancelados', 'En curso', 'Total', 'Tiempo promedio']],
    body: data.resumen.map((r) => [
      r.repartidor, String(r.entregados), String(r.cancelados), String(r.enCurso),
      String(r.entregados + r.cancelados + r.enCurso), duracionTxt(r.minutosPromedio),
    ].map((x) => pdfSafe(x))),
    foot: [['Total', String(t.entregados), String(t.cancelados), String(t.enCurso),
      String(t.entregados + t.cancelados + t.enCurso), duracionTxt(t.minutosPromedio)]],
    theme: 'grid',
    headStyles: { fillColor: NARANJA, textColor: 255, fontSize: 9 },
    footStyles: { fillColor: [245, 245, 245], textColor: 20, fontStyle: 'bold', fontSize: 9 },
    styles: { fontSize: 9, cellPadding: 4 },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
    margin: MARGENES_TABLA,
  });
  pies(doc, `Pedidos por delivery · ${generado}`);
  previewPdfDoc(doc, `delivery-por-repartidor-${data.desde}_${data.hasta}.pdf`);
}
