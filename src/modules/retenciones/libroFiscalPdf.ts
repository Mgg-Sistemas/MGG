/* ============================================================
   MGG · Retenciones · El libro fiscal en PDF

   Lo que se lleva el contador: el rango, los cuatro números de arriba y el
   detalle renglón por renglón. Las anuladas van igual, marcadas, porque el
   libro no puede tener huecos.

   Solo vista previa, por botón: acá nunca se descarga nada solo.
   ============================================================ */
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import { textoPdf, filaPdf } from '@/shared/lib/textoPdf';
import {
  TIPOS_IMPUESTO, labelDireccion,
  type ConfigRetencion, type DireccionRetencion, type ResumenLibro,
} from './retencionesCalculo';
import type { RetencionPracticada } from './retencionesFiscal.repository';

function monto(n: number | null | undefined, moneda: string): string {
  const v = Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return moneda === 'Bs' ? `Bs ${v}` : `$ ${v}`;
}
function fecha(iso: string | null | undefined): string {
  const s = String(iso ?? '').slice(0, 10);
  const [y, m, d] = s.split('-');
  return y && m && d ? `${d}/${m}/${y}` : '—';
}
const corto = (t: string) => TIPOS_IMPUESTO.find((x) => x.key === t)?.corto ?? t;

export interface ContextoLibro {
  desde: string;
  hasta: string;
  direccion: DireccionRetencion | null;
  resumen: ResumenLibro;
  moneda: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function verLibroFiscalPdf(
  filas: RetencionPracticada[],
  config: ConfigRetencion,
  ctx: ContextoLibro,
): Promise<void> {
  const [{ jsPDF }, { default: autoTable }, { loadLogoDataUrl }] = await Promise.all([
    import('jspdf'), import('jspdf-autotable'), import('@/shared/lib/pdfLogo'),
  ]);
  const logo = await loadLogoDataUrl().catch(() => null);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  const W = doc.internal.pageSize.getWidth();
  const MARGIN = 36;
  let y = MARGIN;
  if (logo) { try { doc.addImage(logo, 'JPEG', MARGIN, y, 40, 40); } catch { /* opcional */ } }

  doc.setTextColor(255, 138, 0); doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  doc.text(textoPdf('LIBRO DE RETENCIONES'), W / 2, y + 14, { align: 'center' });
  doc.setTextColor(40, 40, 40); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(textoPdf(`${config.razonSocial ?? '—'}${config.rif ? ` · RIF ${config.rif}` : ''}`), W / 2, y + 28, { align: 'center' });
  const quien = ctx.direccion ? labelDireccion(ctx.direccion) : 'Todas las retenciones';
  doc.text(textoPdf(`${quien} · del ${fecha(ctx.desde)} al ${fecha(ctx.hasta)}`), W / 2, y + 40, { align: 'center' });
  y += 56;

  // Los cuatro números, en una banda
  const tarjetas: [string, string][] = [
    ['A favor (nos retuvieron)', monto(ctx.resumen.aFavor, ctx.moneda)],
    ['IGTF pagado (es costo)', monto(ctx.resumen.igtfPagado, ctx.moneda)],
    ['Por enterar al fisco', monto(ctx.resumen.porEnterar, ctx.moneda)],
    ['Registros', String(ctx.resumen.registros)],
  ];
  const ancho = (W - MARGIN * 2) / tarjetas.length;
  doc.setDrawColor(220, 220, 220); doc.setLineWidth(0.8);
  tarjetas.forEach(([titulo, valor], i) => {
    const x = MARGIN + ancho * i;
    doc.rect(x, y, ancho - 6, 40);
    doc.setFontSize(7); doc.setTextColor(110, 110, 110);
    doc.text(textoPdf(titulo.toUpperCase()), x + 8, y + 14);
    doc.setFontSize(12); doc.setTextColor(20, 20, 20); doc.setFont('helvetica', 'bold');
    doc.text(textoPdf(valor), x + 8, y + 31);
    doc.setFont('helvetica', 'normal');
  });
  y += 54;

  autoTable(doc as any, {
    startY: y,
    head: [filaPdf(['N° comprobante', 'Fecha', 'Imp.', 'Dirección', 'Contraparte', 'RIF', 'Factura', 'Base', '%', 'Retenido', 'Estado'])],
    body: filas.map((r) => filaPdf([
      r.numeroComprobante ?? '—',
      fecha(r.facturaFecha),
      corto(r.tipo),
      r.direccion === 'recibida' ? 'Nos retuvieron' : 'Retuvimos',
      r.contraparteNombre ?? '—',
      r.contraparteRif ?? '—',
      r.facturaNumero ?? (r.docCodigo ?? '—'),
      monto(r.baseImponible, r.moneda),
      `${r.porcentaje}%`,
      monto(r.montoRetenido, r.moneda),
      r.anulada ? 'ANULADA' : (r.estado === 'declarada' ? 'Declarada' : 'Registrada'),
    ])),
    styles: { fontSize: 7.5, cellPadding: 3 },
    headStyles: { fillColor: [255, 138, 0], textColor: 255, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 78, font: 'courier' },
      7: { halign: 'right' }, 8: { halign: 'right' }, 9: { halign: 'right', fontStyle: 'bold' },
    },
    margin: { left: MARGIN, right: MARGIN },
  });

  const finY = (doc as any).lastAutoTable?.finalY ?? y;
  doc.setFontSize(7.5); doc.setTextColor(110, 110, 110);
  doc.text(textoPdf(
    'Lo que nos retienen es un anticipo de impuesto que se descuenta en la declaracion. Lo que retiene la empresa hay que enterarlo al fisco. El IGTF no se recupera: es costo.',
  ), MARGIN, finY + 16, { maxWidth: W - MARGIN * 2 });

  previewPdfDoc(doc, `libro-retenciones-${ctx.desde}-a-${ctx.hasta}.pdf`);
}
