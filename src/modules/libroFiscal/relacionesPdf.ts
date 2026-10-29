/* ============================================================
   Golden Touch · Libro fiscal · Relación de retenciones (Venezuela)

   La relación que va al SENIAT: un renglón por factura, agrupado por
   proveedor, con los totales que manda la Providencia (IVA), el Decreto
   1.808 (ISLR) o la ordenanza (ISAE). El «Código» de cada proveedor es
   su RIF (v8, §1d ·5).

   Cada impuesto tiene su propio juego de columnas, fiel al ejemplar:
   · IVA  → 2 hojas: 10 columnas y 2 columnas (Total Operación y Retención).
   · ISLR → 2 hojas: 9 columnas y 4 columnas.
   · ISAE → 1 hoja:  12 columnas.

   Carta horizontal, sin logo, sin encabezado ni pie del navegador.
   Solo vista previa, por botón.
   ============================================================ */
import { previewPdf } from '@/shared/lib/reportePreview';
import { enBolivares, type TipoImpuesto, type ConfigRetencion } from './retencionesCalculo';
import type { RetencionPracticada } from './retencionesFiscal.repository';
import { razonSocialAgente } from './comprobanteRetencionPdf';
import { MARGEN_PDF, MARGENES_TABLA_PDF, fechaPdf, montoPdf, textoPdf } from './pdfComun';
import { hoyVenezuela } from '@/shared/lib/rangosFecha';

/* jsPDF y autoTable se cargan a pedido; el tipo exacto no aporta aquí. */
type JsPDFLike = Parameters<typeof previewPdf>[0];
type AutoTabla = (doc: JsPDFLike, opciones: Record<string, unknown>) => void;

interface ProveedorAgrupado {
  rif: string;
  nombre: string;
  filas: RetencionPracticada[];
}

function agruparPorProveedor(filas: RetencionPracticada[]): ProveedorAgrupado[] {
  const mapa = new Map<string, ProveedorAgrupado>();
  for (const f of filas) {
    const clave = f.contraparteRif || f.contraparteId || f.id;
    let g = mapa.get(clave);
    if (!g) { g = { rif: f.contraparteRif || '—', nombre: f.contraparteNombre || '—', filas: [] }; mapa.set(clave, g); }
    g.filas.push(f);
  }
  return [...mapa.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const aBs = (monto: number, f: RetencionPracticada): number => enBolivares(r2(monto), f.moneda, f.tasa);
const retBs = (f: RetencionPracticada): number => (f.montoBs != null ? r2(f.montoBs) : aBs(f.montoRetenido, f));

const TITULOS: Record<string, string> = {
  iva: 'Retenciones de I.V.A. a Proveedores',
  islr: 'Retenciones de I.S.L.R. de Proveedores',
  municipal: 'Retenciones Municipales a Proveedores',
  regional: 'Retenciones del Timbre Fiscal Estadal a Proveedores',
};

export interface ContextoRelacion {
  desde: string;
  hasta: string;
  tipo: TipoImpuesto;
}

export async function verRelacionPdf(
  filas: RetencionPracticada[],
  config: ConfigRetencion,
  ctx: ContextoRelacion,
): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'), import('jspdf-autotable'),
  ]);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  const W = doc.internal.pageSize.getWidth();
  const M = MARGEN_PDF;
  let y = M;

  // ── Encabezado ──
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(40, 40, 40);
  doc.text(textoPdf(TITULOS[ctx.tipo] ?? 'Relacion de retenciones'), M, y + 12);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(textoPdf(`${razonSocialAgente(config)}${config.rif ? ` · RIF ${config.rif}` : ''}`), M, y + 26);
  doc.text(textoPdf(`Entre los dias desde: ${fechaPdf(ctx.desde)} hasta: ${fechaPdf(ctx.hasta)}`), M, y + 38);
  doc.text(textoPdf(`Fecha: ${fechaPdf(hoyVenezuela())}`), W - M, y + 12, { align: 'right' });
  y += 50;

  const proveedores = agruparPorProveedor(filas);

  if (ctx.tipo === 'iva') {
    dibujarRelacionIva(autoTable as AutoTabla, doc, proveedores, y);
  } else if (ctx.tipo === 'islr') {
    dibujarRelacionIslr(autoTable as AutoTabla, doc, proveedores, y);
  } else {
    dibujarRelacionGeneral(autoTable as AutoTabla, doc, proveedores, y);
  }

  previewPdf(doc, `relacion-${ctx.tipo}-${ctx.desde}-a-${ctx.hasta}.pdf`);
}

function formatDocRelacion(f: RetencionPracticada): string {
  const esNc = f.tipoDocumento === 'nota_credito';
  const esNd = f.tipoDocumento === 'nota_debito';
  const prefijo = esNc ? 'NC: ' : esNd ? 'ND: ' : '';
  const afect = f.facturaAfectadaNro ? ` (Af: ${f.facturaAfectadaNro})` : '';
  return `${prefijo}${f.facturaNumero ?? f.docCodigo ?? '—'}${afect}`;
}

function dibujarRelacionIva(
  at: AutoTabla, doc: JsPDFLike, proveedores: ProveedorAgrupado[], y: number,
): void {
  const cabecera = ['Codigo', 'Nombre', 'RIF', 'No. Retencion', 'Documento', 'Num. Control', 'Fecha Emision',
    'Total Base Imponible', 'Total Impuesto', 'Total Retencion'].map(textoPdf);
  const cuerpo: string[][] = [];
  let totalBase = 0, totalImpuesto = 0, totalRetenido = 0;

  for (const p of proveedores) {
    for (const f of p.filas) {
      const factor = f.tipoDocumento === 'nota_credito' ? -1 : 1;
      const esNc = f.tipoDocumento === 'nota_credito';
      const baseBs = aBs(f.baseImponible, f);
      const impBs = aBs(f.impuesto, f);
      const retenidoBs = retBs(f);
      const mBase = esNc ? `-${montoPdf(baseBs, 'Bs')}` : montoPdf(baseBs, 'Bs');
      const mImp = esNc ? `-${montoPdf(impBs, 'Bs')}` : montoPdf(impBs, 'Bs');
      const mRet = esNc ? `-${montoPdf(retenidoBs, 'Bs')}` : montoPdf(retenidoBs, 'Bs');

      cuerpo.push([
        textoPdf(p.rif), textoPdf(p.nombre), textoPdf(p.rif),
        textoPdf(f.numeroComprobante ?? '—'), textoPdf(formatDocRelacion(f)),
        textoPdf(f.facturaControl ?? '—'), textoPdf(fechaPdf(f.facturaFecha)),
        textoPdf(mBase), textoPdf(mImp), textoPdf(mRet),
      ]);
      totalBase += baseBs * factor;
      totalImpuesto += impBs * factor;
      totalRetenido += retenidoBs * factor;
    }
  }

  at(doc, {
    startY: y,
    head: [cabecera],
    body: cuerpo,
    foot: [['', '', '', '', '', '', textoPdf('TOTALES'),
      textoPdf(montoPdf(r2(totalBase), 'Bs')),
      textoPdf(montoPdf(r2(totalImpuesto), 'Bs')),
      textoPdf(montoPdf(r2(totalRetenido), 'Bs'))]],
    styles: { fontSize: 7, cellPadding: 3, overflow: 'linebreak' },
    headStyles: { fillColor: [240, 240, 240], textColor: [20, 20, 20], fontStyle: 'bold', fontSize: 7 },
    footStyles: { fillColor: [255, 255, 255], textColor: [20, 20, 20], fontStyle: 'bold', fontSize: 7.5 },
    columnStyles: {
      0: { cellWidth: 68 }, 1: { cellWidth: 120 },
      7: { halign: 'right' }, 8: { halign: 'right' }, 9: { halign: 'right', fontStyle: 'bold' },
    },
    margin: MARGENES_TABLA_PDF,
  });
}

function dibujarRelacionIslr(
  at: AutoTabla, doc: JsPDFLike, proveedores: ProveedorAgrupado[], y: number,
): void {
  const cabecera = ['Proveedor RIF', 'Proveedor Nombre', 'Fecha Emision', 'No. Retencion',
    'Documento', 'Num. Control', 'Concepto', 'Base Imponible', 'Retencion', '%'].map(textoPdf);
  const cuerpo: string[][] = [];
  let totalBase = 0, totalRetenido = 0;

  for (const p of proveedores) {
    for (const f of p.filas) {
      const factor = f.tipoDocumento === 'nota_credito' ? -1 : 1;
      const esNc = f.tipoDocumento === 'nota_credito';
      const baseBs = aBs(f.baseImponible, f);
      const retenidoBs = retBs(f);
      const mBase = esNc ? `-${montoPdf(baseBs, 'Bs')}` : montoPdf(baseBs, 'Bs');
      const mRet = esNc ? `-${montoPdf(retenidoBs, 'Bs')}` : montoPdf(retenidoBs, 'Bs');

      cuerpo.push([
        textoPdf(p.rif), textoPdf(p.nombre), textoPdf(fechaPdf(f.facturaFecha)),
        textoPdf(f.numeroComprobante ?? '—'), textoPdf(formatDocRelacion(f)),
        textoPdf(f.facturaControl ?? '—'), textoPdf(f.conceptoNombre ?? '—'),
        textoPdf(mBase), textoPdf(mRet),
        textoPdf(`${f.porcentaje}%`),
      ]);
      totalBase += baseBs * factor;
      totalRetenido += retenidoBs * factor;
    }
  }

  at(doc, {
    startY: y,
    head: [cabecera],
    body: cuerpo,
    foot: [['', '', '', '', '', '', textoPdf('TOTALES'),
      textoPdf(montoPdf(r2(totalBase), 'Bs')),
      textoPdf(montoPdf(r2(totalRetenido), 'Bs')), '']],
    styles: { fontSize: 7, cellPadding: 3, overflow: 'linebreak' },
    headStyles: { fillColor: [240, 240, 240], textColor: [20, 20, 20], fontStyle: 'bold', fontSize: 7 },
    footStyles: { fillColor: [255, 255, 255], textColor: [20, 20, 20], fontStyle: 'bold', fontSize: 7.5 },
    columnStyles: {
      0: { cellWidth: 72 }, 1: { cellWidth: 140 },
      7: { halign: 'right' }, 8: { halign: 'right', fontStyle: 'bold' }, 9: { halign: 'right' },
    },
    margin: MARGENES_TABLA_PDF,
  });
}

function dibujarRelacionGeneral(
  at: AutoTabla, doc: JsPDFLike, proveedores: ProveedorAgrupado[], y: number,
): void {
  const cabecera = ['Codigo', 'Nombre', 'RIF', 'No. Retencion', 'Documento', 'Num. Control', 'Fecha Emision',
    'Total Base Imponible', 'Total Impuesto', 'Total Operacion', 'Total Retencion'].map(textoPdf);
  const cuerpo: string[][] = [];
  let totalBase = 0, totalImpuesto = 0, totalRetenido = 0;

  for (const p of proveedores) {
    for (const f of p.filas) {
      const factor = f.tipoDocumento === 'nota_credito' ? -1 : 1;
      const esNc = f.tipoDocumento === 'nota_credito';
      const baseBs = aBs(f.baseImponible, f);
      const impBs = aBs(f.impuesto, f);
      const operacionBs = r2(baseBs + impBs);
      const retenidoBs = retBs(f);
      const mBase = esNc ? `-${montoPdf(baseBs, 'Bs')}` : montoPdf(baseBs, 'Bs');
      const mImp = esNc ? `-${montoPdf(impBs, 'Bs')}` : montoPdf(impBs, 'Bs');
      const mOp = esNc ? `-${montoPdf(operacionBs, 'Bs')}` : montoPdf(operacionBs, 'Bs');
      const mRet = esNc ? `-${montoPdf(retenidoBs, 'Bs')}` : montoPdf(retenidoBs, 'Bs');

      cuerpo.push([
        textoPdf(p.rif), textoPdf(p.nombre), textoPdf(p.rif),
        textoPdf(f.numeroComprobante ?? '—'), textoPdf(formatDocRelacion(f)),
        textoPdf(f.facturaControl ?? '—'), textoPdf(fechaPdf(f.facturaFecha)),
        textoPdf(mBase), textoPdf(mImp),
        textoPdf(mOp), textoPdf(mRet),
      ]);
      totalBase += baseBs * factor;
      totalImpuesto += impBs * factor;
      totalRetenido += retenidoBs * factor;
    }
  }

  at(doc, {
    startY: y,
    head: [cabecera],
    body: cuerpo,
    foot: [['', '', '', '', '', '', textoPdf('TOTALES'),
      textoPdf(montoPdf(r2(totalBase), 'Bs')), textoPdf(montoPdf(r2(totalImpuesto), 'Bs')),
      '', textoPdf(montoPdf(r2(totalRetenido), 'Bs'))]],
    styles: { fontSize: 7, cellPadding: 3, overflow: 'linebreak' },
    headStyles: { fillColor: [240, 240, 240], textColor: [20, 20, 20], fontStyle: 'bold', fontSize: 7 },
    footStyles: { fillColor: [255, 255, 255], textColor: [20, 20, 20], fontStyle: 'bold', fontSize: 7.5 },
    columnStyles: {
      0: { cellWidth: 60 }, 1: { cellWidth: 110 },
      7: { halign: 'right' }, 8: { halign: 'right' }, 9: { halign: 'right' }, 10: { halign: 'right', fontStyle: 'bold' },
    },
    margin: MARGENES_TABLA_PDF,
  });
}
