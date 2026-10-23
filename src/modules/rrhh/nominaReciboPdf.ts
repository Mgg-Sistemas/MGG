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
   firma el bono. Los dos recibos llevan el mismo código de nómina.

   Desde el 15-10-2026 (reglas de la administradora): los dos se titulan solo
   «COMPROBANTE DE PAGO»; el de bolívares es SOLO en Bs y no nombra la
   bonificación; el de la bonificación es SOLO en $ y no nombra al otro; firma
   solo el trabajador, centrada al pie de la hoja; arriba a la derecha va la
   fecha de pago (o de emisión si aún no se pagó) y bajo el nombre el RIF.

   EMPRESAS QUE PAGAN EN REAL BRASILEÑO (23-10-2026, traído de Golden Touch): si la
   nómina se cargó con la tasa del Real (`tasa_brl`), el recibo 2/2 sale en $ Y en R$:
   las dos columnas, el neto en las dos monedas y la tasa de cambio usada (1 $ = R$ x).
   El recibo 1/2 (Bs) no cambia.

   Cada recibo entra en UNA carta (datos, desglose, conformidad y firma); si
   algún día no entra, la firma pasa de hoja entera, nunca partida. Los
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
/** R$ con coma decimal: «R$ 100,86». */
export function reales(n: number | null | undefined): string {
  return 'R$ ' + Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
/** La tasa con sus 4 decimales: «5,0428». */
export function tasaRealTexto(t: number): string {
  return Number(t).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
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
  periodo: Pick<NominaPeriodo, 'codigo' | 'tipo' | 'periodo_desde' | 'periodo_hasta' | 'tasa_bcv'>
    & Partial<Pick<NominaPeriodo, 'tasa_brl' | 'tasa_brl_fecha'>>;
  cedulas?: Record<string, string | null | undefined>;   // personal_id -> cédula
}

/** Cuál de los dos recibos se está armando. */
export type HojaRecibo = 'sueldo' | 'bono';

/** Título de cada recibo, como sale impreso debajo del encabezado. */
export function tituloRecibo(hoja: HojaRecibo): string {
  // Desde el 15-10-2026 el título es solo «COMPROBANTE DE PAGO» en los dos (regla de la
  // administradora); cuál es cada uno lo dice su contenido (bolívares o divisas).
  void hoja;
  return 'COMPROBANTE DE PAGO';
}

/** El recibo de la bonificación pasado a Real brasileño (cada importe redondeado, para que la tabla cuadre). */
export interface BonoEnReal {
  /** R$ por 1 USD. */
  tasa: number;
  bono: number;
  /** Cada descuento (préstamos, anticipos…), en el mismo orden que `lineasBono`. */
  lineas: number[];
  deduccion: number;
  neto: number;
}

/**
 * La bonificación en R$ a la tasa de la nómina; null si la nómina no trae tasa del Real
 * (empresa que paga en dólares: el recibo sale como siempre). Los descuentos se redondean uno
 * por uno y el neto sale de esos importes, así lo que se ve en la tabla suma exacto.
 */
export function bonoEnReal(c: ReciboCalculado, tasaBrl?: number | null): BonoEnReal | null {
  const tasa = Number(tasaBrl);
  if (!(tasa > 0)) return null;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const bono = r2(c.bonoUsd * tasa);
  const lineas = c.lineasBono.map((ln) => r2(ln.usd * tasa));
  const deduccion = r2(lineas.reduce((a, n) => a + n, 0));
  return { tasa, bono, lineas, deduccion, neto: r2(Math.max(0, bono - deduccion)) };
}

/**
 * El texto de conformidad de cada recibo. Cada uno certifica SOLO lo que se
 * entrega con él, en su moneda, y nombra al otro para que nadie crea que un
 * recibo es la remuneración completa. El 2/2 cierra con el total de los dos.
 */
export function textoConformidad(hoja: HojaRecibo, c: ReciboCalculado, periodo = '', real: BonoEnReal | null = null): string {
  if (hoja === 'sueldo') {
    // SOLO bolívares y con el texto que dictó la administradora (15-10-2026): monto y
    // período; ni equivalente en $, ni tasa, ni mención de la bonificación.
    const del = periodo && periodo !== '—' ? ` al período del ${periodo}` : '';
    return `Certifico haber recibido la cantidad de ${bsStr(c.netoBs)}, que conforme a la totalidad de mi salario${del}. Y firmo en señal de conformidad.`;
  }
  // SOLO dólares en el de la bonificación (15-10-2026): nada en Bs.
  const descuento = c.deduccionBonoUsd > 0
    ? ` (bono de ${usd(c.bonoUsd)} menos ${usd(c.deduccionBonoUsd)} de préstamos y anticipos)`
    : '';
  // Empresa que paga en Real: se certifica también el equivalente y la tasa de cambio usada.
  const equivalente = real
    ? ` (equivalente a ${reales(real.neto)} en Real brasileño, a la tasa de cambio de 1 $ = R$ ${tasaRealTexto(real.tasa)})`
    : '';
  return `Certifico haber recibido ${usd(c.bonoNetoUsd)} de bonificación en divisas${equivalente}${descuento} por el período indicado, según este recibo, y firmo en señal de conformidad.`;
}

/**
 * Pago quincenal y diario EN BOLÍVARES del recibo 1/2 (15-10-2026): como el formato
 * que usa la administración (sueldo quincenal = días trabajados + descanso, diario =
 * quincenal ÷ 15). Solo las líneas con días; bonos y viáticos van aparte en la tabla.
 */
export function pagoQuincenalBs(c: ReciboCalculado): { quincenal: number; diario: number } {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const quincenal = c.lineas
    .filter((ln) => ln.tipo === 'devengado' && ln.dias != null)
    .reduce((a, ln) => a + aBs(ln.usd, c.tasa), 0);
  return { quincenal: r2(quincenal), diario: r2(quincenal / 15) };
}

/**
 * El período que imprime el recibo (15-10-2026): el de la nómina; si la nómina no lo
 * trae, el que el renglón tiene pegado (join a nomina_periodos). «Desde al hasta», o
 * una sola fecha si son iguales; «—» solo si no hay ninguna.
 */
export function textoPeriodo(
  meta: { periodo: Pick<NominaPeriodo, 'periodo_desde' | 'periodo_hasta'> },
  r?: Pick<NominaRenglon, 'periodo'> | null,
): string {
  const desde = meta.periodo.periodo_desde || r?.periodo?.periodo_desde || null;
  const hasta = meta.periodo.periodo_hasta || r?.periodo?.periodo_hasta || null;
  if (!desde) return '—';
  return hasta && hasta !== desde ? `${fmtDate(desde)} al ${fmtDate(hasta)}` : fmtDate(desde);
}

/**
 * La fecha que lleva el comprobante arriba a la derecha (15-10-2026): la del PAGO si el
 * renglón ya se pagó; si no, la de emisión (el día en que se imprime). Antes salía el
 * inicio del período, que ya está en la tabla y confundía con la fecha del documento.
 */
export function fechaDocumento(r: Pick<NominaRenglon, 'estado' | 'pagada_en'>, hoyIso: string): string {
  const base = r.estado === 'pagada' && r.pagada_en ? r.pagada_en : hoyIso;
  return (r.estado === 'pagada' && r.pagada_en ? 'Pagado el ' : 'Emitido el ') + fmtDate(base);
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
function cabecera(l: Lienzo, r: NominaRenglon, meta: ReciboMeta, hoja: HojaRecibo, c: ReciboCalculado): number {
  const { doc, autoTable, logoDataUrl, PAGE_W } = l;
  const MARGIN = MARGEN_PDF; // 2 cm (margen uniforme en todos los lados)
  let y = MARGIN;

  const LOGO = 56;
  if (logoDataUrl) { try { doc.addImage(logoDataUrl, 'JPEG', MARGIN, y, LOGO, LOGO); } catch { /* logo opcional */ } }
  const tx = logoDataUrl ? MARGIN + LOGO + 14 : MARGIN;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  // La razón social sale de la EMPRESA del renglón, no de una constante: el
  // recibo tiene que decir a nombre de quién se paga.
  const empresa = definicionEmpresa(normalizarEmpresa(r.empresa));
  doc.text(empresa.razonSocial, tx, y + 16);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  // Debajo del nombre va el RIF (el título de abajo ya dice «COMPROBANTE DE PAGO»; no se
  // repite). Si la empresa no tiene RIF cargado, el subtítulo genérico.
  doc.text(empresa.rif ? `RIF ${empresa.rif}` : 'Comprobante de Pago de Personal', tx, y + 32);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text(meta.periodo.codigo ?? '', PAGE_W - MARGIN, y + 16, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  // Fecha local (no UTC): de noche en Venezuela el ISO de UTC ya es «mañana».
  const ahora = new Date();
  const hoyIso = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`;
  doc.text(fechaDocumento(r, hoyIso), PAGE_W - MARGIN, y + 32, { align: 'right' });
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
      ['Período', textoPeriodo(meta, r),
        'Días', `${Number(r.dias_trabajados) || 0} trabajados + ${Number(r.dias_descanso) || 0} de descanso`],
      // 1/2 (solo bolívares, 15-10-2026): pago quincenal y diario en Bs, como el formato de la
      // administración. 2/2: el sueldo mensual en $, que es la base del bono.
      ...(hoja === 'sueldo'
        ? [
            ['Estado', r.estado === 'pagada' ? `Pagado${r.pagada_en ? ' · ' + fmtDate(r.pagada_en) : ''}` : 'Por pagar',
              'Forma de pago', 'Bs'],
            ['Pago quincenal', bsStr(pagoQuincenalBs(c).quincenal), 'Pago diario', bsStr(pagoQuincenalBs(c).diario)],
          ]
        : [
            ['Estado', r.estado === 'pagada' ? `Pagado${r.pagada_en ? ' · ' + fmtDate(r.pagada_en) : ''}` : 'Por pagar',
              'Sueldo mensual', usd(r.sueldo_base_mensual)],
            // Empresa que paga en Real: la forma de pago y la tasa de cambio, a la vista.
            ...(bonoEnReal(c, meta.periodo.tasa_brl)
              ? [['Forma de pago', 'Divisas ($) y Real brasileño (R$)',
                  'Tasa de cambio', `1 $ = R$ ${tasaRealTexto(Number(meta.periodo.tasa_brl))}${meta.periodo.tasa_brl_fecha ? ` (${fmtDate(meta.periodo.tasa_brl_fecha)})` : ''}`]]
              : []),
          ]),
    ],
    margin: MARGENES_TABLA_PDF,
    theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 3 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 90 }, 2: { fontStyle: 'bold', cellWidth: 90 } },
  });
  return finalY(doc, y) + 6;
}

/** Conformidad (y seriales, si van) y firmas al pie. Devuelve nada: cierra la hoja. */
function pie(l: Lienzo, r: NominaRenglon, meta: ReciboMeta, hoja: HojaRecibo, c: ReciboCalculado, yIni: number): void {
  const { doc, PAGE_W, PAGE_H } = l;
  const MARGIN = MARGEN_PDF;
  let y = yIni;

  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  const lineasConformidad = doc.splitTextToSize(textoConformidad(hoja, c, textoPeriodo(meta, r), hoja === 'bono' ? bonoEnReal(c, meta.periodo.tasa_brl) : null), anchoUtilPdf(PAGE_W)) as string[];
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

  // Firma: al PIE de la hoja y EN EL MEDIO (orden de la administradora, 15-10-2026).
  // El bloque termina (fy + 22) dentro del margen inferior; si lo de arriba llegó hasta
  // la raya, pasa ENTERO a la hoja siguiente (nunca la raya en una hoja y el nombre en
  // la otra). Solo firma el trabajador (la firma de RRHH se quitó el 15-10-2026), con
  // el nombre debajo de la raya.
  const fy = limiteInferiorPdf(PAGE_H) - 40;
  if (y + 16 > fy) doc.addPage();
  const colW = (anchoUtilPdf(PAGE_W) - 40) / 2;
  const x0 = (PAGE_W - colW) / 2;
  doc.setDrawColor(120); doc.setLineWidth(0.7);
  doc.line(x0, fy, x0 + colW, fy);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text('Firma del trabajador', x0 + colW / 2, fy + 11, { align: 'center' });
  doc.text(r.nombre, x0 + colW / 2, fy + 22, { align: 'center' });
}

/* ───────── Recibo 1/2 · pago en bolívares ───────── */
function hojaSueldo(l: Lienzo, r: NominaRenglon, meta: ReciboMeta, c: ReciboCalculado): void {
  const { doc, autoTable } = l;
  let y = cabecera(l, r, meta, 'sueldo', c);
  const tasa = c.tasa;

  /* LA TABLA: solo lo que se paga EN BOLÍVARES y SOLO EN BOLÍVARES (regla de la
     administradora, 15-10-2026): ni columnas «en $», ni equivalente, ni tasa. Es la
     parte «sueldo» repartida en días, más los extras, menos las deducciones de ley.
     Se imprimen TODOS los conceptos aunque estén en cero: así el recibo es siempre
     el mismo documento y quien lo firma ve que no se le omitió ningún descuento.
     Columnas como el formato de la administración: concepto, días, devengado,
     deducción y saldo. */
  const filas = c.lineas.map((ln, i) => ([
    String(i + 1),
    ln.concepto,
    ln.dias != null ? String(ln.dias) : '',
    ln.tipo === 'devengado' ? bsStr(aBs(ln.usd, tasa)) : '',
    ln.tipo === 'deduccion' ? bsStr(aBs(ln.usd, tasa)) : '',
  ]));

  autoTable(doc, {
    startY: y,
    head: [['#', 'CONCEPTO', 'DÍAS', 'DEVENGADO Bs', 'DEDUCCIÓN Bs']],
    body: filas,
    foot: [
      ['', 'TOTALES', '', bsStr(c.totalDevengadoBs), bsStr(c.totalDeduccionBs)],
      ['', 'NETO A PAGAR EN BOLÍVARES', '', bsStr(c.netoBs), ''],
    ],
    margin: MARGENES_TABLA_PDF,
    styles: { fontSize: 8.5, cellPadding: 2.5 },
    headStyles: { fillColor: [255, 138, 0], textColor: 255, fontStyle: 'bold', halign: 'center' },
    footStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 18, halign: 'center' },
      2: { cellWidth: 40, halign: 'center' },
      3: { halign: 'right', cellWidth: 110 }, 4: { halign: 'right', cellWidth: 110 },
    },
  });
  y = finalY(doc, y) + 6;

  /* Ya no va un segundo cuadro «PAGO DE ESTE RECIBO» (15-10-2026): repetía el mismo
     neto tres veces (totales, neto a pagar, neto entregado). El pie «NETO A PAGAR EN
     BOLÍVARES» de la tabla ES lo que se entrega con este recibo, y la conformidad lo
     certifica. Sin mención de la bonificación. */
  pie(l, r, meta, 'sueldo', c, y);
}

/* ───────── Recibo 2/2 · bonificación en divisas ───────── */
function hojaBono(l: Lienzo, r: NominaRenglon, meta: ReciboMeta, c: ReciboCalculado): void {
  const { doc, autoTable } = l;
  let y = cabecera(l, r, meta, 'bono', c);

  /* EL BONO: el 80 %, en divisas. De acá se descuentan préstamos y anticipos:
     se prestan en dólares y se cobran en dólares. Si el bono no alcanza, el
     resto baja al recibo 1/2 como «(resto)»; la deuda no se perdona. */
  // Empresa que paga en Real (23-10-2026): las mismas filas con dos columnas más en R$, el neto en
  // las dos monedas y la tasa de cambio. Sin tasa del Real, la tabla es la de siempre.
  const real = bonoEnReal(c, meta.periodo.tasa_brl);
  const descuentoUsd = (ln: { usd: number }) => (ln.usd ? `- ${usd(ln.usd)}` : usd(0));
  const filasBono: string[][] = [
    ['1', 'Bonificación de la quincena (80 % del total acordado)', usd(c.bonoUsd), '', ...(real ? [reales(real.bono), ''] : [])],
    // Guion ASCII, no el «−» tipográfico: Helvetica del PDF no lo tiene y lo pinta como comilla (09-10-2026).
    ...c.lineasBono.map((ln, i) => [
      String(i + 2), `(-) ${ln.concepto}`, '', descuentoUsd(ln),
      ...(real ? ['', real.lineas[i] ? `- ${reales(real.lineas[i])}` : reales(0)] : []),
    ]),
  ];
  const finBonoFilas: (string | { content: string; colSpan?: number; styles?: { halign: 'right' } })[][] = real
    ? [
        ['', 'TOTALES', usd(c.bonoUsd), usd(c.deduccionBonoUsd), reales(real.bono), reales(real.deduccion)],
        ['', 'BONIFICACIÓN A ENTREGAR EN DIVISAS ($ y R$)', usd(c.bonoNetoUsd), '', reales(real.neto), ''],
        ['', 'TASA DE CAMBIO', { content: `1 $ = R$ ${tasaRealTexto(real.tasa)}${meta.periodo.tasa_brl_fecha ? ` (${fmtDate(meta.periodo.tasa_brl_fecha)})` : ''}`, colSpan: 4, styles: { halign: 'right' } }],
      ]
    : [
        ['', 'TOTALES', usd(c.bonoUsd), usd(c.deduccionBonoUsd)],
        ['', 'BONIFICACIÓN A ENTREGAR EN DIVISAS', usd(c.bonoNetoUsd), ''],
      ];
  autoTable(doc, {
    startY: y,
    head: [real
      ? ['#', 'CONCEPTO', 'DEVENGADO $', 'DESCUENTO $', 'DEVENGADO R$', 'DESCUENTO R$']
      : ['#', 'CONCEPTO', 'DEVENGADO $', 'DESCUENTO $']],
    body: filasBono,
    foot: finBonoFilas,
    margin: MARGENES_TABLA_PDF,
    styles: { fontSize: real ? 8 : 8.5, cellPadding: 2.5 },
    headStyles: { fillColor: [55, 55, 55], textColor: 255, fontStyle: 'bold', halign: 'center' },
    footStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: 'bold' },
    columnStyles: real
      ? {
          0: { cellWidth: 16, halign: 'center' },
          2: { halign: 'right', cellWidth: 70 }, 3: { halign: 'right', cellWidth: 70 },
          4: { halign: 'right', cellWidth: 76 }, 5: { halign: 'right', cellWidth: 76 },
        }
      : { 0: { cellWidth: 18, halign: 'center' }, 2: { halign: 'right', cellWidth: 105 }, 3: { halign: 'right', cellWidth: 105 } },
  });
  y = finalY(doc, y) + 6;

  /* Desde el 15-10-2026 este recibo es SOLO en dólares (regla de la administradora):
     ya no lleva el cuadro con el pago en bolívares ni el total de los dos recibos. */
  pie(l, r, meta, 'bono', c, y);
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
