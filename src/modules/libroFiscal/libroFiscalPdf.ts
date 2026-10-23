/* ============================================================
   Golden Touch · Libro fiscal · El libro en PDF

   Lo que se lleva el contador: el rango, los cuatro números de arriba y el
   detalle renglón por renglón. Las anuladas van igual, marcadas, porque el
   libro no puede tener huecos. Cada renglón lleva además lo retenido en
   bolívares, que es como se declara.

   Solo vista previa, por botón: aquí nunca se descarga nada solo.
   ============================================================ */
import { previewPdf } from '@/shared/lib/reportePreview';
import {
  TIPOS_IMPUESTO, labelDireccion,
  type ConfigRetencion, type DireccionRetencion, type ResumenLibro,
} from './retencionesCalculo';
import type { RetencionPracticada } from './retencionesFiscal.repository';
import { razonSocialAgente } from './comprobanteRetencionPdf';
import {
  MARGEN_PDF, MARGENES_TABLA_PDF, anchoUtilPdf, fechaPdf, filaPdf, limiteInferiorPdf, montoPdf, textoPdf,
} from './pdfComun';

const corto = (t: string) => TIPOS_IMPUESTO.find((x) => x.key === t)?.corto ?? t;

export interface ContextoLibro {
  desde: string;
  hasta: string;
  direccion: DireccionRetencion | null;
  resumen: ResumenLibro;
  /** Un total por moneda: Bs y $ no se suman. */
  totales: { moneda: string; resumen: ResumenLibro }[];
}

export async function verLibroFiscalPdf(
  filas: RetencionPracticada[],
  config: ConfigRetencion,
  ctx: ContextoLibro,
): Promise<void> {
  const [{ jsPDF }, { default: autoTable }, { loadLogoPdfDataUrl, dibujarLogoPdf }] = await Promise.all([
    import('jspdf'), import('jspdf-autotable'), import('@/shared/lib/pdfLogo'),
  ]);
  const logo = await loadLogoPdfDataUrl().catch(() => null);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  const W = doc.internal.pageSize.getWidth();
  const MARGIN = MARGEN_PDF;
  let y = MARGIN;
  // El logo de los PDF de GT es horizontal: se dibuja a su proporción, nunca en un cuadrado.
  if (logo) dibujarLogoPdf(doc, logo, MARGIN, y - 6, 56);

  doc.setTextColor(255, 138, 0); doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  doc.text(textoPdf('LIBRO DE RETENCIONES'), W / 2, y + 14, { align: 'center' });
  doc.setTextColor(40, 40, 40); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(textoPdf(`${razonSocialAgente(config)}${config.rif ? ` · RIF ${config.rif}` : ''}`), W / 2, y + 28, { align: 'center' });
  const quien = ctx.direccion ? labelDireccion(ctx.direccion) : 'Todas las retenciones';
  doc.text(textoPdf(`${quien} · del ${fechaPdf(ctx.desde)} al ${fechaPdf(ctx.hasta)}`), W / 2, y + 40, { align: 'center' });
  y += 56;

  // Los cuatro números, en una banda. Los montos, un renglón por moneda.
  const enMonedas = (campo: 'aFavor' | 'igtfPagado' | 'porEnterar') =>
    ctx.totales.length ? ctx.totales.map((t) => montoPdf(t.resumen[campo], t.moneda)) : [montoPdf(0, 'Bs')];
  const tarjetas: [string, string[]][] = [
    ['Retenciones recibidas (a favor)', enMonedas('aFavor')],
    ['IGTF percibido (costo)', enMonedas('igtfPagado')],
    ['Por enterar al fisco', enMonedas('porEnterar')],
    ['Registros', [String(ctx.resumen.registros)]],
  ];
  const ancho = (W - MARGIN * 2) / tarjetas.length;
  doc.setDrawColor(220, 220, 220); doc.setLineWidth(0.8);
  tarjetas.forEach(([titulo, valor], i) => {
    const x = MARGIN + ancho * i;
    doc.rect(x, y, ancho - 6, 40);
    doc.setFontSize(7); doc.setTextColor(110, 110, 110);
    doc.text(textoPdf(titulo.toUpperCase()), x + 8, y + 14);
    // Con más de una moneda, más chico para que los dos renglones quepan en la tarjeta.
    doc.setFontSize(valor.length > 1 ? 9 : 12); doc.setTextColor(20, 20, 20); doc.setFont('helvetica', 'bold');
    doc.text(valor.map((v) => textoPdf(v)), x + 8, valor.length > 1 ? y + 24 : y + 31);
    doc.setFont('helvetica', 'normal');
  });
  y += 54;

  autoTable(doc as any, {
    startY: y,
    head: [filaPdf(['N° comprobante', 'Fecha', 'Imp.', 'Dirección', 'Contraparte', 'RIF', 'Documento', 'Base', '%', 'Retenido', 'Retenido Bs', 'Estado'])],
    body: filas.map((r) => {
      const esNc = r.tipoDocumento === 'nota_credito';
      const esNd = r.tipoDocumento === 'nota_debito';
      const docPrefijo = esNc ? 'NC ' : esNd ? 'ND ' : '';
      const docAfecta = r.facturaAfectadaNro ? ` (Af: ${r.facturaAfectadaNro})` : '';
      const docTxt = `${docPrefijo}${r.facturaNumero ?? (r.docCodigo ?? '—')}${docAfecta}`;

      const montoRetenidoBs = r.anulada
        ? '0,00 Bs'
        : (r.montoBs != null
            ? (esNc ? `-${montoPdf(r.montoBs, 'Bs')}` : montoPdf(r.montoBs, 'Bs'))
            : '—');

      const montoRetenidoOrig = r.anulada
        ? '0,00'
        : (esNc ? `-${montoPdf(r.montoRetenido, r.moneda)}` : montoPdf(r.montoRetenido, r.moneda));

      return filaPdf([
        r.numeroComprobante ?? '—',
        fechaPdf(r.facturaFecha),
        corto(r.tipo),
        r.direccion === 'recibida' ? 'Recibida' : 'Practicada',
        r.contraparteNombre ?? '—',
        r.contraparteRif ?? '—',
        docTxt,
        montoPdf(r.baseImponible, r.moneda),
        `${r.porcentaje}%`,
        montoRetenidoOrig,
        montoRetenidoBs,
        r.anulada ? 'ANULADA' : (r.estado === 'declarada' ? 'Declarada' : 'Registrada'),
      ]);
    }),
    styles: { fontSize: 7.5, cellPadding: 3 },
    headStyles: { fillColor: [255, 138, 0], textColor: 255, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 78, font: 'courier' },
      7: { halign: 'right' }, 8: { halign: 'right' }, 9: { halign: 'right', fontStyle: 'bold' }, 10: { halign: 'right' },
    },
    margin: MARGENES_TABLA_PDF,
  });

  let finY = (doc as any).lastAutoTable?.finalY ?? y;
  // La nota (dos renglones) no puede pasar del margen inferior: si no cabe, va en hoja nueva.
  if (finY + 16 + 20 > limiteInferiorPdf(doc.internal.pageSize.getHeight())) { doc.addPage(); finY = MARGIN - 8; }
  doc.setFontSize(7.5); doc.setTextColor(110, 110, 110);
  doc.text(textoPdf(
    'Las retenciones recibidas constituyen un anticipo de impuesto descontable en la declaración. Las retenciones practicadas representan montos pendientes de enteramiento al fisco. El IGTF percibido no es recuperable: se registra como costo.',
  ), MARGIN, finY + 16, { maxWidth: anchoUtilPdf(W) });

  previewPdf(doc, `libro-retenciones-${ctx.desde}-a-${ctx.hasta}.pdf`);
}
