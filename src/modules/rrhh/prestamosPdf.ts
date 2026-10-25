/* ============================================================
   MGG · RRHH · Estado de cuenta de préstamos (PDF)

   Lo que se le entrega al trabajador —o lo que se archiva— cuando hay que
   mostrar cuánto se le prestó, cuánto ya pagó y cuánto debe.

   Son dos documentos con el mismo formato:
   · el de UNA persona, con cada préstamo y sus abonos uno por uno;
   · el CONSOLIDADO, con una línea por trabajador y el total de la empresa.

   Las tres cifras van arriba y en grande. Es lo único que la mayoría va a
   mirar; el detalle está abajo para el que lo discuta.

   Solo vista previa, por botón: acá nunca se descarga nada solo.
   ============================================================ */
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import { textoPdf, filaPdf } from '@/shared/lib/textoPdf';
import { MARGEN_PDF, MARGENES_TABLA_PDF, limiteInferiorPdf, anchoUtilPdf } from '@/shared/lib/pdfMargen';
import { date as fmtDate } from '@/shared/lib/format';
import type { Personal } from '@/shared/lib/types';
import { definicionEmpresa, normalizarEmpresa } from './empresa';
import { numeroFicha } from './fichaPersonal';
import {
  estadoDeCuenta, fechaDePrestamo, labelOrigen, obtenerEntregas,
  type DeudaTrabajador, type PagoBase, type PrestamoBase,
} from './prestamos';

const NARANJA: [number, number, number] = [217, 83, 30]; // #d9531e
const GRIS: [number, number, number] = [100, 116, 139];   // #64748b
const TINTA: [number, number, number] = [15, 23, 42];     // #0f172a
const ROJO: [number, number, number] = [220, 38, 38];     // #dc2626
const VERDE: [number, number, number] = [22, 163, 74];    // #16a34a
const AZUL: [number, number, number] = [59, 130, 246];    // #3b82f6
const AMBER: [number, number, number] = [245, 158, 11];   // #f59e0b
const BORDE: [number, number, number] = [226, 232, 240];  // #e2e8f0
const FONDO_CARD: [number, number, number] = [255, 255, 255];
const FONDO_BANNER: [number, number, number] = [254, 252, 248];

const usd = (v: unknown) => `$ ${(Number(v) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Texto del rango, para el encabezado. Vacío si no se filtró por fechas. */
function textoRango(desde?: string | null, hasta?: string | null): string {
  if (desde && hasta) return `Del ${fmtDate(desde)} al ${fmtDate(hasta)}`;
  if (desde) return `Desde el ${fmtDate(desde)}`;
  if (hasta) return `Hasta el ${fmtDate(hasta)}`;
  return 'Todos los períodos';
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Encabezado común: logo, título, empresa y el rango que se está mirando. */
async function encabezado(doc: any, W: number, M: number, titulo: string, sub: string, rango: string, detallePersona?: string): Promise<number> {
  const { loadLogoDataUrl } = await import('@/shared/lib/pdfLogo');
  const logo = await loadLogoDataUrl().catch(() => null);
  let y = M;
  if (logo) { try { doc.addImage(logo, 'JPEG', M, y - 2, 42, 42); } catch { /* el logo es opcional */ } }
  doc.setTextColor(...NARANJA); doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  doc.text(textoPdf(titulo), W / 2, y + 12, { align: 'center' });
  doc.setTextColor(51, 65, 85); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  doc.text(textoPdf(sub), W / 2, y + 25, { align: 'center' });
  doc.setFontSize(7.5); doc.setTextColor(...GRIS);
  const linea3 = [detallePersona, rango ? `Período: ${rango}` : '', `Emitido el ${fmtDate(new Date().toISOString())}`].filter(Boolean).join(' · ');
  doc.text(textoPdf(linea3), W / 2, y + 36, { align: 'center' });

  // Línea sutil divisoria
  doc.setDrawColor(...BORDE); doc.setLineWidth(0.6);
  doc.line(M, y + 43, W - M, y + 43);

  return y + 52;
}

interface CajaMetrica { label: string; valor: string; topColor: [number, number, number]; valColor: [number, number, number] }

/** Cajas métricas con franja de color superior, repartidas en todo el ancho. */
function cajasMetricas(doc: any, W: number, M: number, y: number, cajas: CajaMetrica[]): number {
  const gap = 6;
  const ancho = (anchoUtilPdf(W) - ((cajas.length - 1) * gap)) / cajas.length;
  const alto = 42;

  cajas.forEach((c, i) => {
    const x = M + i * (ancho + gap);
    doc.setDrawColor(...BORDE);
    doc.setLineWidth(0.6);
    doc.setFillColor(...FONDO_CARD);
    doc.roundedRect(x, y, ancho, alto, 3, 3, 'FD');

    // Franja de color superior
    doc.setFillColor(...c.topColor);
    doc.rect(x + 2, y, ancho - 4, 2.5, 'F');

    // Rótulo
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.8);
    doc.setTextColor(...GRIS);
    doc.text(textoPdf(c.label), x + ancho / 2, y + 13, { align: 'center' });

    // Cifra
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...c.valColor);
    doc.text(textoPdf(c.valor), x + ancho / 2, y + 31, { align: 'center' });
  });

  return y + alto + 10;
}

/** Las 5 cajas del estado de cuenta. */
function cajasTotales5(
  doc: any, W: number, M: number, y: number,
  total: number, pagado: number, debe: number,
  cantPrestamos: number, cantConSaldo: number,
): number {
  return cajasMetricas(doc, W, M, y, [
    { label: 'TOTAL PRESTADO', valor: usd(total), topColor: NARANJA, valColor: TINTA },
    { label: 'TOTAL PAGADO', valor: usd(pagado), topColor: VERDE, valColor: VERDE },
    { label: 'PENDIENTE', valor: usd(debe), topColor: ROJO, valColor: debe > 0 ? ROJO : VERDE },
    { label: 'PRÉSTAMOS', valor: String(cantPrestamos), topColor: AZUL, valColor: TINTA },
    { label: 'CON SALDO', valor: String(cantConSaldo), topColor: AMBER, valColor: cantConSaldo > 0 ? AMBER : VERDE },
  ]);
}

/** Banner con franja naranja izquierda para los datos del trabajador */
function bannerTrabajador(
  doc: any, W: number, M: number, y: number,
  persona: Personal, saldoDebe: number,
): number {
  const alto = 34;
  const ancho = anchoUtilPdf(W);

  doc.setDrawColor(...BORDE);
  doc.setLineWidth(0.6);
  doc.setFillColor(...FONDO_BANNER);
  doc.roundedRect(M, y, ancho, alto, 3, 3, 'FD');

  // Franja vertical naranja
  doc.setFillColor(...NARANJA);
  doc.rect(M, y, 4, alto, 'F');

  // Nombre
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(...TINTA);
  doc.text(textoPdf(`${persona.nombre} ${persona.apellido ?? ''}`.trim().toUpperCase()), M + 10, y + 13);

  // Saldo a la derecha
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...ROJO);
  doc.text(textoPdf(`Saldo pendiente: ${usd(saldoDebe)}`), W - M - 8, y + 13, { align: 'right' });

  // Ficha, cédula, cargo, departamento
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...GRIS);
  const ficha = numeroFicha(persona.numero_ficha);
  const lineaDatos = [
    ficha || '',
    persona.cedula ? `C.I.: ${persona.cedula}` : '',
    persona.cargo ? `Cargo: ${persona.cargo}` : '',
    persona.departamento ? `Dpto: ${persona.departamento}` : '',
  ].filter(Boolean).join(' · ');
  doc.text(textoPdf(lineaDatos), M + 10, y + 26);

  return y + alto + 10;
}

/** Pie con la firma de conformidad. Solo en el de una persona. */
function firmas(doc: any, W: number, M: number, H: number, yActual: number) {
  const limite = limiteInferiorPdf(H);
  if (yActual > limite - 60) doc.addPage();
  const y = limite - 44;
  doc.setDrawColor(150, 150, 150); doc.setLineWidth(0.6);
  const ancho = 190;
  doc.line(M, y, M + ancho, y);
  doc.line(W - M - ancho, y, W - M, y);
  doc.setFontSize(7.5); doc.setTextColor(...GRIS);
  doc.text(textoPdf('Firma del trabajador'), M + ancho / 2, y + 12, { align: 'center' });
  doc.text(textoPdf('Por la empresa'), W - M - ancho / 2, y + 12, { align: 'center' });
  doc.setFontSize(7);
  doc.text(
    textoPdf('El saldo se descuenta por cuotas en la nómina hasta saldar. Este documento refleja el estado a la fecha de emisión.'),
    W / 2, limite, { align: 'center' },
  );
}

/**
 * Estado de cuenta de UNA persona: diseño moderno con tarjetas KPI y tabla naranja continua.
 */
export async function verEstadoCuentaPrestamosPdf(
  persona: Personal,
  prestamos: PrestamoBase[],
  pagos: PagoBase[],
  rango?: { desde?: string | null; hasta?: string | null },
): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = MARGEN_PDF;
  const emp = definicionEmpresa(normalizarEmpresa(persona.empresa));
  const ec = estadoDeCuenta(persona.id, prestamos, pagos);

  const cantPrestamos = ec.renglones.length;
  const cantConSaldo = ec.renglones.filter((r) => r.debe > 0).length;

  const primerPrestamo = ec.renglones[0]?.prestamo;
  const fechaPrestamoRef = primerPrestamo ? `Préstamo del ${fmtDate(fechaDePrestamo(primerPrestamo))}` : '';

  let y = await encabezado(
    doc, W, M,
    'ESTADO DE CUENTA · PRÉSTAMO',
    `${emp.razonSocial} · Nómina ${persona.empresa || 'General'}`,
    textoRango(rango?.desde, rango?.hasta),
    `${persona.nombre} ${persona.apellido ?? ''}${fechaPrestamoRef ? ` · ${fechaPrestamoRef}` : ''}`,
  );

  // 1. Tarjetas métricas superiores (5 tarjetas)
  y = cajasTotales5(doc, W, M, y, ec.total, ec.pagado, ec.debe, cantPrestamos, cantConSaldo);

  // 2. Banner de trabajador con saldo pendiente
  y = bannerTrabajador(doc, W, M, y, persona, ec.debe);

  if (!ec.renglones.length) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...GRIS);
    doc.text(textoPdf('Esta persona no tiene préstamos ni anticipos registrados en el período.'), M, y + 15);
    firmas(doc, W, M, H, y + 40);
    await previewPdfDoc(doc, `estado-cuenta-${(persona.nombre ?? '').toLowerCase()}.pdf`);
    return;
  }

  // 3. Tabla continua con cabecera naranja vibrante
  const tableRows: any[][] = [];
  const rowTypes: Array<'prestamo' | 'abono'> = [];

  for (const r of ec.renglones) {
    const entregas = obtenerEntregas(r.prestamo);
    const fechaTxt = entregas.length > 1
      ? entregas.map((e) => fmtDate(e.fecha)).join(' · ')
      : fmtDate(fechaDePrestamo(r.prestamo));

    const tipoTxt = `${r.prestamo.tipo === 'anticipo' ? 'Anticipo' : 'Préstamo'}${entregas.length > 1 ? ` (${entregas.length} ent.)` : ''}`;

    const motivoTxt = entregas.length > 1
      ? entregas.map((e) => `[Entrega ${fmtDate(e.fecha)} · ${usd(e.monto)}]: ${e.motivo || 'Préstamo autorizado'}`).join('\n')
      : (r.prestamo.motivo || 'Préstamo autorizado');

    tableRows.push([
      fechaTxt,
      tipoTxt,
      motivoTxt,
      usd(r.prestamo.monto_total),
      usd(r.pagado),
      usd(r.debe),
      r.debe > 0 ? 'Activo' : 'Saldado',
    ]);
    rowTypes.push('prestamo');

    for (const p of r.pagos) {
      tableRows.push([
        `• ${fmtDate(p.fecha)}`,
        `• ${labelOrigen(p.origen)}`,
        p.nota || 'Abono a deuda registrado',
        '—',
        usd(p.monto),
        '—',
        '—',
      ]);
      rowTypes.push('abono');
    }
  }

  autoTable(doc as any, {
    startY: y,
    head: [filaPdf(['FECHA', 'TIPO / ORIGEN', 'MOTIVO / NOTA DE ABONO', 'PRESTADO', 'PAGADO', 'SALDO', 'ESTADO'])],
    body: tableRows.map((r) => filaPdf(r)),
    theme: 'grid',
    headStyles: {
      fillColor: NARANJA,
      textColor: [255, 255, 255],
      fontSize: 7.5,
      fontStyle: 'bold',
      halign: 'center',
      valign: 'middle',
      lineColor: [200, 70, 20],
      lineWidth: 0.5,
    },
    bodyStyles: {
      fontSize: 7.6,
      lineColor: BORDE,
      lineWidth: 0.4,
      valign: 'middle',
    },
    columnStyles: {
      0: { cellWidth: 72, halign: 'center' },
      1: { cellWidth: 78, halign: 'left' },
      2: { cellWidth: 'auto', halign: 'left' },
      3: { cellWidth: 58, halign: 'right' },
      4: { cellWidth: 58, halign: 'right' },
      5: { cellWidth: 58, halign: 'right' },
      6: { cellWidth: 48, halign: 'center' },
    },
    didParseCell: (data: any) => {
      if (data.section === 'body') {
        const tipoFila = rowTypes[data.row.index];
        if (tipoFila === 'prestamo') {
          data.cell.styles.fontStyle = 'bold';
          if (data.column.index === 3) data.cell.styles.textColor = TINTA;
          if (data.column.index === 4) data.cell.styles.textColor = VERDE;
          if (data.column.index === 5) data.cell.styles.textColor = ROJO;
          if (data.column.index === 6) data.cell.styles.textColor = AMBER;
          data.cell.styles.fillColor = [255, 255, 255];
        } else {
          data.cell.styles.textColor = [71, 85, 105];
          if (data.column.index === 4) {
            data.cell.styles.textColor = VERDE;
            data.cell.styles.fontStyle = 'bold';
          }
          data.cell.styles.fillColor = [250, 252, 254];
        }
      }
    },
    margin: MARGENES_TABLA_PDF,
  });

  const finalY = (doc as any).lastAutoTable?.finalY ?? y;
  firmas(doc, W, M, H, finalY);
  await previewPdfDoc(doc, `estado-cuenta-${(persona.nombre ?? '').toLowerCase()}.pdf`);
}

/**
 * Consolidado: una línea por trabajador con deuda, y el total de la empresa.
 *
 * Es el que se lleva a una reunión. Ordenado por lo que debe, de mayor a
 * menor, que es el orden en que hay que mirarlo.
 */
export async function verConsolidadoPrestamosPdf(
  deudas: DeudaTrabajador[],
  rango?: { desde?: string | null; hasta?: string | null },
  empresa?: string | null,
): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  const W = doc.internal.pageSize.getWidth();
  const M = MARGEN_PDF;
  const emp = definicionEmpresa(normalizarEmpresa(empresa));

  let y = await encabezado(
    doc, W, M,
    'PRESTAMOS Y ANTICIPOS · CONSOLIDADO',
    emp.razonSocial,
    textoRango(rango?.desde, rango?.hasta),
  );

  const total = deudas.reduce((a, d) => a + d.total, 0);
  const pagado = deudas.reduce((a, d) => a + d.pagado, 0);
  const debe = deudas.reduce((a, d) => a + d.debe, 0);
  const totalPrestamos = deudas.reduce((a, d) => a + d.prestamos.length, 0);
  const conSaldo = deudas.filter((d) => d.debe > 0).length;

  y = cajasTotales5(doc, W, M, y, total, pagado, debe, totalPrestamos, conSaldo);

  autoTable(doc as any, {
    startY: y,
    head: [filaPdf(['TRABAJADOR', 'PRÉSTAMOS', 'DESDE', 'PRESTADO', 'PAGADO', 'SALDO', 'ESTADO'])],
    body: deudas.map((d) => filaPdf([
      d.nombre,
      String(d.prestamos.length),
      d.desde ? fmtDate(d.desde) : '—',
      usd(d.total),
      usd(d.pagado),
      usd(d.debe),
      d.debe > 0 ? 'Activo' : 'Saldado',
    ])),
    foot: [filaPdf(['TOTAL GENERAL', String(totalPrestamos), '', usd(total), usd(pagado), usd(debe), conSaldo > 0 ? `${conSaldo} pendientes` : 'Al día'])],
    theme: 'grid',
    headStyles: { fillColor: NARANJA, textColor: [255, 255, 255], fontSize: 7.5, fontStyle: 'bold', lineColor: [200, 70, 20], lineWidth: 0.5 },
    footStyles: { fillColor: [254, 243, 235], textColor: TINTA, fontSize: 8.5, fontStyle: 'bold', lineColor: BORDE, lineWidth: 0.5 },
    bodyStyles: { fontSize: 8, lineColor: BORDE, lineWidth: 0.4 },
    columnStyles: {
      1: { cellWidth: 58, halign: 'center' },
      2: { cellWidth: 70 },
      3: { cellWidth: 65, halign: 'right' },
      4: { cellWidth: 65, halign: 'right' },
      5: { cellWidth: 65, halign: 'right', fontStyle: 'bold' },
      6: { cellWidth: 55, halign: 'center' },
    },
    didParseCell: (data: any) => {
      if (data.section === 'body') {
        if (data.column.index === 4) data.cell.styles.textColor = VERDE;
        if (data.column.index === 5 && deudas[data.row.index]?.debe > 0) data.cell.styles.textColor = ROJO;
        if (data.column.index === 6) data.cell.styles.textColor = deudas[data.row.index]?.debe > 0 ? AMBER : VERDE;
      }
    },
    margin: MARGENES_TABLA_PDF,
  });

  await previewPdfDoc(doc, 'prestamos-consolidado.pdf');
}

/**
 * Recibo individual de entrega o abono de préstamo/anticipo en PDF.
 *
 * Con el mismo diseño del estado de cuenta (el de Golden Touch): cajas de
 * montos con franja de color, banner del trabajador y tabla de cabecera
 * naranja. Si el pago fue en otra moneda (Bs, COP, EUR) muestra el monto, la
 * tasa y la conversión en $ al cambio. Los textos largos (el motivo de cada
 * entrega) van en celdas que se ajustan solas: nada se encima.
 */
export async function verReciboPrestamoPdf(opciones: {
  tipo: 'entrega' | 'abono';
  persona: Personal;
  prestamo: PrestamoBase;
  montoUsd: number;
  fecha: string;
  moneda?: string | null;
  montoOriginal?: number | null;
  tasaCambio?: number | null;
  motivo?: string | null;
  saldoRestante?: number | null;
}): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = MARGEN_PDF;
  const { persona, prestamo } = opciones;
  const emp = definicionEmpresa(normalizarEmpresa(persona.empresa));
  const esEntrega = opciones.tipo === 'entrega';
  const nombreTipo = prestamo.tipo === 'anticipo' ? 'ANTICIPO' : 'PRÉSTAMO';
  const tipoMinus = prestamo.tipo === 'anticipo' ? 'Anticipo' : 'Préstamo';

  const mon = (opciones.moneda || 'USD').toUpperCase();
  const esOtraMoneda = mon !== 'USD';
  const montoOrig = opciones.montoOriginal != null && opciones.montoOriginal > 0 ? opciones.montoOriginal : opciones.montoUsd;
  const tasa = opciones.tasaCambio && opciones.tasaCambio > 0 ? opciones.tasaCambio : null;
  const saldo = opciones.saldoRestante != null ? Math.max(0, Number(opciones.saldoRestante) || 0) : null;

  let y = await encabezado(
    doc, W, M,
    esEntrega ? `RECIBO DE ENTREGA · ${nombreTipo}` : `RECIBO DE ABONO · ${nombreTipo}`,
    `${emp.razonSocial} · Nómina ${persona.empresa || 'General'}`,
    '',
    `${`${persona.nombre} ${persona.apellido ?? ''}`.trim()} · ${esEntrega ? 'Entrega' : 'Abono'} del ${fmtDate(opciones.fecha)}`,
  );

  /* ── Cajas de montos (con la conversión si fue en otra moneda) ── */
  const colorSaldo = (saldo ?? 0) > 0 ? ROJO : VERDE;
  const cajas: CajaMetrica[] = [];
  if (esOtraMoneda) {
    const simbolo = mon === 'VES' || mon === 'BS' ? 'Bs' : mon === 'EUR' ? '€' : mon === 'COP' ? 'COP $' : mon;
    cajas.push(
      { label: `MONTO ${esEntrega ? 'ENTREGADO' : 'ABONADO'} (${mon})`, valor: `${simbolo} ${montoOrig.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, topColor: NARANJA, valColor: TINTA },
      { label: 'TASA DE CAMBIO', valor: tasa ? `${tasa.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} ${simbolo}/$` : 'Según cambio oficial', topColor: AZUL, valColor: TINTA },
      { label: 'EQUIVALENTE EN $', valor: usd(opciones.montoUsd), topColor: VERDE, valColor: VERDE },
      { label: 'SALDO PENDIENTE', valor: saldo != null ? usd(saldo) : '—', topColor: ROJO, valColor: colorSaldo },
    );
  } else {
    cajas.push(
      { label: `MONTO ${esEntrega ? 'ENTREGADO' : 'ABONADO'} (USD)`, valor: usd(opciones.montoUsd), topColor: VERDE, valColor: VERDE },
      { label: `TOTAL DEL ${nombreTipo}`, valor: usd(prestamo.monto_total), topColor: NARANJA, valColor: TINTA },
      { label: 'SALDO PENDIENTE', valor: saldo != null ? usd(saldo) : '—', topColor: ROJO, valColor: colorSaldo },
    );
  }
  y = cajasMetricas(doc, W, M, y, cajas);

  /* ── Banner del trabajador ── */
  y = bannerTrabajador(doc, W, M, y, persona, saldo ?? 0);

  /* ── Detalle de la operación: tabla de cabecera naranja ── */
  const filas: string[][] = [];
  const estilos: Array<'normal' | 'total'> = [];
  if (esEntrega) {
    const entregas = obtenerEntregas(prestamo);
    if (entregas.length > 1) {
      entregas.forEach((e, i) => {
        filas.push([fmtDate(e.fecha), `${tipoMinus} ${i + 1}`, e.motivo || `${tipoMinus} autorizado`, usd(e.monto)]);
        estilos.push('normal');
      });
    } else {
      filas.push([fmtDate(opciones.fecha), tipoMinus, opciones.motivo || prestamo.motivo || `${tipoMinus} autorizado`, usd(opciones.montoUsd)]);
      estilos.push('normal');
    }
    filas.push(['', '', 'Total entregado', usd(opciones.montoUsd)]);
    estilos.push('total');
  } else {
    filas.push([fmtDate(opciones.fecha), 'Abono / pago de cuota', opciones.motivo || 'Abono a deuda registrado', usd(opciones.montoUsd)]);
    estilos.push('normal');
    filas.push(['', '', 'Total abonado', usd(opciones.montoUsd)]);
    estilos.push('total');
  }
  if (saldo != null) {
    filas.push(['', '', 'Saldo deudor resultante', usd(saldo)]);
    estilos.push('total');
  }

  autoTable(doc as any, {
    startY: y,
    head: [filaPdf(['FECHA', 'TIPO / OPERACIÓN', 'CONCEPTO / MOTIVO', 'MONTO (USD)'])],
    body: filas.map((r) => filaPdf(r)),
    theme: 'grid',
    headStyles: {
      fillColor: NARANJA, textColor: [255, 255, 255], fontSize: 7.5, fontStyle: 'bold',
      halign: 'center', valign: 'middle', lineColor: [200, 70, 20], lineWidth: 0.5,
    },
    bodyStyles: { fontSize: 7.8, lineColor: BORDE, lineWidth: 0.4, valign: 'middle', overflow: 'linebreak' },
    columnStyles: {
      0: { cellWidth: 72, halign: 'center' },
      1: { cellWidth: 100, halign: 'left' },
      2: { cellWidth: 'auto', halign: 'left' },
      3: { cellWidth: 82, halign: 'right' },
    },
    didParseCell: (data: any) => {
      if (data.section !== 'body') return;
      if (estilos[data.row.index] === 'total') {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = FONDO_BANNER;
        if (data.column.index === 2) data.cell.styles.halign = 'right';
        if (data.column.index === 3) data.cell.styles.textColor = data.row.index === filas.length - 1 && saldo != null ? colorSaldo : TINTA;
      } else {
        data.cell.styles.fillColor = [255, 255, 255];
        if (data.column.index === 3) { data.cell.styles.fontStyle = 'bold'; data.cell.styles.textColor = VERDE; }
      }
    },
    margin: MARGENES_TABLA_PDF,
  });

  y = ((doc as any).lastAutoTable?.finalY ?? y) + 16;

  /* ── Texto de conformidad ── */
  const montoUsdTxt = (Number(opciones.montoUsd) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const txtMonedaFinal = esOtraMoneda
    ? `${montoOrig.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${mon} (equivalentes a $ ${montoUsdTxt} al cambio)`
    : `$ ${montoUsdTxt}`;
  const textoDeclaracion = esEntrega
    ? `Certifico haber recibido a mi entera satisfacción por parte de la empresa la cantidad de ${txtMonedaFinal}, bajo la figura de ${prestamo.tipo === 'anticipo' ? 'anticipo' : 'préstamo'}. Autorizo su descuento según las condiciones acordadas.`
    : `Certifico haber realizado el pago / abono por la cantidad de ${txtMonedaFinal} a cuenta del saldo pendiente del ${prestamo.tipo === 'anticipo' ? 'anticipo' : 'préstamo'} otorgado.`;

  if (y > limiteInferiorPdf(H) - 110) { doc.addPage(); y = M; }
  doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(...GRIS);
  const lineasDecl = doc.splitTextToSize(textoPdf(textoDeclaracion), anchoUtilPdf(W)) as string[];
  doc.text(lineasDecl, M, y);
  y += lineasDecl.length * 11 + 20;

  firmas(doc, W, M, H, y);
  await previewPdfDoc(doc, `recibo-${opciones.tipo}-${(persona.nombre ?? '').toLowerCase()}.pdf`);
}
