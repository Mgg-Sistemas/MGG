/* ============================================================
   MGG · RRHH · Comprobantes de pago de personal (recibos)

   DOS recibos por trabajador (regla de la administradora, 09-10-2026):

     1/2 · PAGO EN BOLÍVARES — la parte del 20 % repartida en
           días, más bonos extra y viáticos, menos las deducciones de ley
           (IVSS, RPE, FAOV, sindicato, otros). Es lo que se paga en Bs.
     2/2 · BONIFICACIÓN EN DIVISAS — el bono (80 %) menos préstamos y
           anticipos. Es lo que se entrega en dólares.

   La palabra «sueldo» no va en el 1/2 (pedido de la administradora, 09-10): se llama «pago en bolívares». Antes iba todo en una hoja. Se separan porque se pagan en monedas
   distintas, muchas veces en días distintos, y cada entrega necesita su
   propia firma: quien cobra el sueldo firma el sueldo, quien recibe el bono
   firma el bono. Los dos recibos llevan el mismo código de nómina y se
   nombran entre sí, y el 2/2 cierra con el total de los dos.

   Cada recibo entra en UNA carta (datos, desglose, conformidad y firmas); si
   algún día no entra, las firmas pasan de hoja enteras, nunca partidas. Los
   seriales de billetes van en el 2/2, que es el que se paga en efectivo.
   ============================================================ */
import { loadLogoDataUrl } from '@/shared/lib/pdfLogo';
import { MARGEN_PDF, MARGENES_TABLA_PDF, limiteInferiorPdf, anchoUtilPdf } from '@/shared/lib/pdfMargen';
import { definicionEmpresa, normalizarEmpresa } from './empresa';
import { date as fmtDate } from '@/shared/lib/format';
import { aBs, calcularRecibo, type ReciboCalculado } from './sueldoQuincena';
import type { NominaPeriodo, NominaRenglon } from '@/shared/lib/types';

function usd(n: number | null | undefined): string {
  return '$ ' + Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function bsStr(n: number | null | undefined): string {
  return 'Bs ' + Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function labelMotivo(tipo?: string | null): string {
  switch (tipo) {
    case 'vacaciones': return 'Vacaciones';
    case 'liquidacion': return 'Liquidación';
    case 'quincena': return 'Sueldo (quincena)';
    default: return 'Sueldo';
  }
}

export interface ReciboMeta {
  periodo: Pick<NominaPeriodo, 'codigo' | 'tipo' | 'periodo_desde' | 'periodo_hasta' | 'tasa_bcv'>;
  cedulas?: Record<string, string | null | undefined>;   // personal_id -> cédula
}

/** Cuál de los dos recibos se está armando. */
export type HojaRecibo = 'sueldo' | 'bono';

/** Título de cada recibo, como sale impreso debajo del encabezado. */
export function tituloRecibo(hoja: HojaRecibo): string {
  return hoja === 'sueldo'
    ? 'COMPROBANTE DE PAGO 1/2 · PAGO EN BOLÍVARES'
    : 'COMPROBANTE DE PAGO 2/2 · BONIFICACIÓN EN DIVISAS';
}

/**
 * El texto de conformidad de cada recibo. Cada uno certifica SOLO lo que se
 * entrega con él, en su moneda, y nombra al otro para que nadie crea que un
 * recibo es la remuneración completa. El 2/2 cierra con el total de los dos.
 */
export function textoConformidad(hoja: HojaRecibo, c: ReciboCalculado): string {
  const tasaStr = c.tasa.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (hoja === 'sueldo') {
    return `Certifico haber recibido ${bsStr(c.netoBs)} en bolívares (${usd(c.netoUsd)} a la tasa de ${tasaStr} Bs/$) por el período indicado, según el desglose de este recibo 1 de 2. La bonificación en divisas se entrega con el recibo 2 de 2. Firmo en señal de conformidad.`;
  }
  const descuento = c.deduccionBonoUsd > 0
    ? ` (bono de ${usd(c.bonoUsd)} menos ${usd(c.deduccionBonoUsd)} de préstamos y anticipos)`
    : '';
  return `Certifico haber recibido ${usd(c.bonoNetoUsd)} de bonificación en divisas${descuento} por el período indicado, según este recibo 2 de 2. El pago en bolívares se entregó con el recibo 1 de 2 (${bsStr(c.netoBs)}, ${usd(c.netoUsd)}). Entre los dos recibos queda cubierta la totalidad de mi remuneración del período, ${usd(c.totalRecibidoUsd)}. Firmo en señal de conformidad.`;
}

/** Lo que se le pasa al cálculo del recibo, sacado del renglón de nómina. */
function calcularDe(r: NominaRenglon, meta: ReciboMeta): ReciboCalculado {
  /* La tasa es la de la quincena: se guardó al cerrarla y no se recalcula.
     Si el renglón ya se pagó con una tasa propia, manda esa, porque es la
     que de verdad se usó para entregar el dinero. */
  const tasa = Number(r.tasa_pago) || Number(meta.periodo.tasa_bcv) || 0;
  return calcularRecibo({
    // Del BRUTO ya calculado, no del sueldo mensual: así el recibo suma
    // exactamente lo que la nómina liquidó, con cualquier reparto de días.
    brutoQuincena: Number(r.salario_bruto) || 0,
    diasTrabajados: Number(r.dias_trabajados) || 0,
    diasDescanso: Number(r.dias_descanso) || 0,
    bonosExtra: Number(r.asignaciones) || 0,
    viaticos: Number(r.viaticos) || 0,
    deducciones: {
      ivss: Number(r.deduc_ivss) || 0,
      rpe: Number(r.deduc_rpe) || 0,
      faov: Number(r.deduc_faov) || 0,
      sindicato: Number(r.deduc_sindicato) || 0,
      prestamos: Number(r.deduc_prestamos) || 0,
      anticipos: Number(r.deduc_anticipos) || 0,
      otros: Number(r.deduc_otros) || 0,
    },
    tasa,
  });
}

type Doc = import('jspdf').jsPDF;
type AutoTable = typeof import('jspdf-autotable').default;

interface Lienzo {
  doc: Doc;
  autoTable: AutoTable;
  logoDataUrl: string | null;
  PAGE_W: number;
  PAGE_H: number;
}

function finalY(doc: Doc, fallback: number): number {
  // lastAutoTable lo agrega el plugin en runtime.
  return (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? fallback;
}

/** Encabezado (logo, empresa, código, fecha), raya naranja, título del recibo y datos del trabajador. */
function cabecera(l: Lienzo, r: NominaRenglon, meta: ReciboMeta, hoja: HojaRecibo): number {
  const { doc, autoTable, logoDataUrl, PAGE_W } = l;
  const MARGIN = MARGEN_PDF; // 2 cm (margen uniforme en todos los lados)
  let y = MARGIN;

  const LOGO = 56;
  if (logoDataUrl) { try { doc.addImage(logoDataUrl, 'JPEG', MARGIN, y, LOGO, LOGO); } catch { /* logo opcional */ } }
  const tx = logoDataUrl ? MARGIN + LOGO + 14 : MARGIN;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  // La razón social sale de la EMPRESA del renglón, no de una constante: el
  // recibo tiene que decir a nombre de quién se paga.
  doc.text(definicionEmpresa(normalizarEmpresa(r.empresa)).razonSocial, tx, y + 16);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text('Comprobante de Pago de Personal', tx, y + 32);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text(meta.periodo.codigo ?? '', PAGE_W - MARGIN, y + 16, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  const fecha = meta.periodo.periodo_desde ? fmtDate(meta.periodo.periodo_desde) : (r.pagada_en ? fmtDate(r.pagada_en) : '');
  doc.text(fecha, PAGE_W - MARGIN, y + 32, { align: 'right' });
  y += Math.max(LOGO, 40) + 6;

  doc.setDrawColor(255, 138, 0); doc.setLineWidth(1.5);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 14;

  // Título grande: dice CUÁL de los dos recibos es.
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
  doc.text(tituloRecibo(hoja), MARGIN, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text(`Motivo: ${labelMotivo(meta.periodo.tipo)}`, PAGE_W - MARGIN, y, { align: 'right' });
  y += 14;

  // Datos del trabajador (iguales en los dos recibos).
  const cedula = meta.cedulas?.[r.personal_id ?? ''] || '';
  autoTable(doc, {
    startY: y,
    body: [
      ['Trabajador', r.nombre, 'Cédula', cedula || '—'],
      ['Cargo', r.cargo || '—', 'Departamento', r.departamento || '—'],
      ['Período', meta.periodo.periodo_desde
        ? `${fmtDate(meta.periodo.periodo_desde)}${meta.periodo.periodo_hasta ? ' al ' + fmtDate(meta.periodo.periodo_hasta) : ''}`
        : '—',
        'Días', `${Number(r.dias_trabajados) || 0} trabajados + ${Number(r.dias_descanso) || 0} de descanso`],
      ['Estado', r.estado === 'pagada' ? `Pagado${r.pagada_en ? ' · ' + fmtDate(r.pagada_en) : ''}` : 'Por pagar',
        'Sueldo mensual', usd(r.sueldo_base_mensual)],
    ],
    margin: MARGENES_TABLA_PDF,
    theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 3 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 90 }, 2: { fontStyle: 'bold', cellWidth: 90 } },
  });
  return finalY(doc, y) + 6;
}

/** Conformidad (y seriales, si van) y firmas al pie. Devuelve nada: cierra la hoja. */
function pie(l: Lienzo, r: NominaRenglon, hoja: HojaRecibo, c: ReciboCalculado, yIni: number): void {
  const { doc, PAGE_W, PAGE_H } = l;
  const MARGIN = MARGEN_PDF;
  let y = yIni;

  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  const lineasConformidad = doc.splitTextToSize(textoConformidad(hoja, c), anchoUtilPdf(PAGE_W)) as string[];
  // Si no entra sobre el margen inferior, la conformidad pasa a la hoja siguiente.
  if (y + 10 + lineasConformidad.length * 10 > limiteInferiorPdf(PAGE_H)) { doc.addPage(); y = MARGIN; }
  doc.text(lineasConformidad, MARGIN, y + 10);
  y += 10 + lineasConformidad.length * 10;

  // Los seriales son de los billetes en divisas: van en el recibo del bono.
  if (hoja === 'bono' && r.seriales_billetes && r.seriales_billetes.length) {
    doc.setFontSize(8);
    const seriales = doc.splitTextToSize(`Seriales de billetes: ${r.seriales_billetes.join(', ')}`, anchoUtilPdf(PAGE_W)) as string[];
    if (y + 8 + seriales.length * 10 > limiteInferiorPdf(PAGE_H)) { doc.addPage(); y = MARGIN; }
    doc.text(seriales, MARGIN, y + 8);
    y += 8 + seriales.length * 10;
  }

  // Firmas (al pie de la página). El bloque termina (fy + 22) dentro del margen
  // inferior; si lo de arriba llegó hasta la raya, las firmas pasan ENTERAS a la
  // hoja siguiente (nunca la raya en una hoja y el nombre en la otra).
  const fy = limiteInferiorPdf(PAGE_H) - 40;
  if (y + 16 > fy) doc.addPage();
  const colW = (anchoUtilPdf(PAGE_W) - 40) / 2;
  doc.setDrawColor(120); doc.setLineWidth(0.7);
  doc.line(MARGIN, fy, MARGIN + colW, fy);
  doc.line(MARGIN + colW + 40, fy, MARGIN + colW * 2 + 40, fy);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text('Firma del trabajador', MARGIN + colW / 2, fy + 11, { align: 'center' });
  doc.text(r.nombre, MARGIN + colW / 2, fy + 22, { align: 'center' });
  doc.text('Firma de la Jefa de RRHH', MARGIN + colW + 40 + colW / 2, fy + 11, { align: 'center' });
  doc.text('Recursos Humanos', MARGIN + colW + 40 + colW / 2, fy + 22, { align: 'center' });
}

/* ───────── Recibo 1/2 · pago en bolívares ───────── */
function hojaSueldo(l: Lienzo, r: NominaRenglon, meta: ReciboMeta, c: ReciboCalculado): void {
  const { doc, autoTable } = l;
  let y = cabecera(l, r, meta, 'sueldo');
  const tasa = c.tasa;

  /* LA TABLA: solo lo que se paga EN BOLÍVARES, o sea la parte «sueldo»
     (20 %) repartida en días, más los extras, menos las deducciones de ley.
     Se imprimen TODOS los conceptos aunque estén en cero: así el recibo es
     siempre el mismo documento y quien lo firma ve que no se le omitió
     ningún descuento. */
  const filas = c.lineas.map((ln, i) => ([
    String(i + 1),
    ln.dias != null ? `${ln.concepto} (${ln.dias})` : ln.concepto,
    ln.tipo === 'devengado' ? bsStr(aBs(ln.usd, tasa)) : '',
    ln.tipo === 'devengado' ? usd(ln.usd) : '',
    ln.tipo === 'deduccion' ? bsStr(aBs(ln.usd, tasa)) : '',
    ln.tipo === 'deduccion' ? usd(ln.usd) : '',
  ]));

  autoTable(doc, {
    startY: y,
    head: [['#', 'CONCEPTO', 'DEVENGADO Bs', 'en $', 'DEDUCCIÓN Bs', 'en $']],
    body: filas,
    foot: [
      ['', 'TOTALES', bsStr(c.totalDevengadoBs), usd(c.totalDevengadoUsd), bsStr(c.totalDeduccionBs), usd(c.totalDeduccionUsd)],
      ['', 'NETO A PAGAR EN BOLÍVARES', bsStr(c.netoBs), usd(c.netoUsd), '', ''],
    ],
    margin: MARGENES_TABLA_PDF,
    styles: { fontSize: 8.5, cellPadding: 2.5 },
    headStyles: { fillColor: [255, 138, 0], textColor: 255, fontStyle: 'bold', halign: 'center' },
    footStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 18, halign: 'center' },
      2: { halign: 'right' }, 3: { halign: 'right' },
      4: { halign: 'right' }, 5: { halign: 'right' },
    },
  });
  y = finalY(doc, y) + 6;

  /* EL PAGO: lo que se entrega con este recibo, con la tasa a la vista, y la
     nota de que el bono va aparte. */
  autoTable(doc, {
    startY: y,
    head: [['PAGO DE ESTE RECIBO', 'Bs', 'Equivalente $']],
    body: [
      ['Pago en bolívares (20 % del total acordado)', bsStr(c.netoBs), usd(c.netoUsd)],
      ['Tasa aplicada (BCV de la quincena)', tasa > 0 ? `${bsStr(tasa)} / $` : '—', ''],
      ['Bonificación en divisas', 'va en el recibo 2/2', usd(c.bonoNetoUsd)],
    ],
    foot: [['TOTAL ENTREGADO CON ESTE RECIBO', bsStr(c.netoBs), usd(c.netoUsd)]],
    margin: MARGENES_TABLA_PDF,
    styles: { fontSize: 8.5, cellPadding: 2.5 },
    headStyles: { fillColor: [255, 138, 0], textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right', cellWidth: 125 }, 2: { halign: 'right', cellWidth: 105 } },
  });
  y = finalY(doc, y) + 6;

  pie(l, r, 'sueldo', c, y);
}

/* ───────── Recibo 2/2 · bonificación en divisas ───────── */
function hojaBono(l: Lienzo, r: NominaRenglon, meta: ReciboMeta, c: ReciboCalculado): void {
  const { doc, autoTable } = l;
  let y = cabecera(l, r, meta, 'bono');

  /* EL BONO: el 80 %, en divisas. De acá se descuentan préstamos y anticipos:
     se prestan en dólares y se cobran en dólares. Si el bono no alcanza, el
     resto baja al recibo 1/2 como «(resto)»; la deuda no se perdona. */
  autoTable(doc, {
    startY: y,
    head: [['#', 'CONCEPTO', 'DEVENGADO $', 'DESCUENTO $']],
    body: [
      ['1', 'Bonificación de la quincena (80 % del total acordado)', usd(c.bonoUsd), ''],
      // Guion ASCII, no el «−» tipográfico: Helvetica del PDF no lo tiene y lo pinta como comilla (09-10-2026).
      ...c.lineasBono.map((ln, i) => [String(i + 2), `(-) ${ln.concepto}`, '', ln.usd ? `- ${usd(ln.usd)}` : usd(0)]),
    ],
    foot: [
      ['', 'TOTALES', usd(c.bonoUsd), usd(c.deduccionBonoUsd)],
      ['', 'BONIFICACIÓN A ENTREGAR EN DIVISAS', usd(c.bonoNetoUsd), ''],
    ],
    margin: MARGENES_TABLA_PDF,
    styles: { fontSize: 8.5, cellPadding: 2.5 },
    headStyles: { fillColor: [55, 55, 55], textColor: 255, fontStyle: 'bold', halign: 'center' },
    footStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 18, halign: 'center' }, 2: { halign: 'right', cellWidth: 105 }, 3: { halign: 'right', cellWidth: 105 } },
  });
  y = finalY(doc, y) + 6;

  /* EL TOTAL DE LA QUINCENA: los dos recibos juntos, cada uno en la moneda en
     que se paga. Es lo que la persona se lleva entre los dos. */
  autoTable(doc, {
    startY: y,
    head: [['TOTAL DE LA QUINCENA (RECIBOS 1/2 + 2/2)', 'Bs', 'Equivalente $']],
    body: [
      ['Recibo 1/2 · pago en bolívares', bsStr(c.netoBs), usd(c.netoUsd)],
      ['Recibo 2/2 · bonificación en divisas (menos préstamos y anticipos)', '', usd(c.bonoNetoUsd)],
    ],
    foot: [['TOTAL RECIBIDO EN EL PERÍODO', '', usd(c.totalRecibidoUsd)]],
    margin: MARGENES_TABLA_PDF,
    styles: { fontSize: 8.5, cellPadding: 2.5 },
    headStyles: { fillColor: [55, 55, 55], textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right', cellWidth: 115 }, 2: { halign: 'right', cellWidth: 115 } },
  });
  y = finalY(doc, y) + 6;

  pie(l, r, 'bono', c, y);
}

async function construir(renglones: NominaRenglon[], meta: ReciboMeta) {
  const [logoDataUrl, { jsPDF }, { default: autoTable }] = await Promise.all([
    loadLogoDataUrl().catch(() => null),
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const l: Lienzo = {
    doc, autoTable, logoDataUrl,
    PAGE_W: doc.internal.pageSize.getWidth(),
    PAGE_H: doc.internal.pageSize.getHeight(),
  };

  // Dos recibos por persona, uno detrás del otro: 1/2 pago en Bs, 2/2 bono en $.
  renglones.forEach((r, idx) => {
    const c = calcularDe(r, meta);
    if (idx > 0) doc.addPage();
    hojaSueldo(l, r, meta, c);
    doc.addPage();
    hojaBono(l, r, meta, c);
  });

  return doc;
}

function nombreArchivo(renglones: NominaRenglon[], meta: ReciboMeta): string {
  const base = renglones.length === 1
    ? `recibos-${renglones[0].nombre}`
    : `comprobantes-${meta.periodo.codigo ?? 'nomina'}`;
  return base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '.pdf';
}

/**
 * Abre los comprobantes de pago en VISTA PREVIA (dos por trabajador: sueldo
 * en Bs y bonificación en divisas).
 *
 * Antes bajaba el archivo de una. En MGG ningún reporte se descarga solo: se
 * muestra, y se baja o se imprime desde el visor si hace falta. Un recibo que
 * se descarga sin verse es un recibo que se imprime con el error adentro.
 */
export async function descargarNominaReciboPdf(renglones: NominaRenglon[], meta: ReciboMeta): Promise<void> {
  if (!renglones.length) throw new Error('No hay renglones para el comprobante.');
  const { previewPdfDoc } = await import('@/shared/lib/reportPreview');
  const doc = await construir(renglones, meta);
  previewPdfDoc(doc, nombreArchivo(renglones, meta));
}

/**
 * Abre los comprobantes en VISTA PREVIA, dos páginas por trabajador, para
 * revisarlos antes de mandarlos a la impresora.
 *
 * Es lo que se usa al imprimir por lote: cuando salen veinte personas de una,
 * bajar el archivo y abrirlo aparte para recién ahí ver que faltaba uno es el
 * camino largo. Acá se ven, se imprimen desde el visor, y nada se descarga si
 * no se pide.
 */
export async function verNominaRecibosPdf(renglones: NominaRenglon[], meta: ReciboMeta): Promise<void> {
  if (!renglones.length) throw new Error('No hay recibos seleccionados para imprimir.');
  const { previewPdfDoc } = await import('@/shared/lib/reportPreview');
  const doc = await construir(renglones, meta);
  previewPdfDoc(doc, nombreArchivo(renglones, meta));
}
