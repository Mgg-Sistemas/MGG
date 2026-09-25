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
import { date as fmtDate } from '@/shared/lib/format';
import type { Personal } from '@/shared/lib/types';
import { definicionEmpresa, normalizarEmpresa } from './empresa';
import { numeroFicha } from './fichaPersonal';
import {
  estadoDeCuenta, fechaDePrestamo, labelOrigen,
  type DeudaTrabajador, type PagoBase, type PrestamoBase,
} from './prestamos';

const NARANJA: [number, number, number] = [255, 138, 0];
const GRIS: [number, number, number] = [120, 120, 120];
const TINTA: [number, number, number] = [40, 40, 40];
const ROJO: [number, number, number] = [200, 60, 60];
const VERDE: [number, number, number] = [40, 150, 90];

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
async function encabezado(doc: any, W: number, M: number, titulo: string, sub: string, rango: string): Promise<number> {
  const { loadLogoDataUrl } = await import('@/shared/lib/pdfLogo');
  const logo = await loadLogoDataUrl().catch(() => null);
  let y = M;
  if (logo) { try { doc.addImage(logo, 'JPEG', M, y, 42, 42); } catch { /* el logo es opcional */ } }
  doc.setTextColor(...NARANJA); doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
  doc.text(textoPdf(titulo), W / 2, y + 14, { align: 'center' });
  doc.setTextColor(60, 60, 60); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(textoPdf(sub), W / 2, y + 28, { align: 'center' });
  doc.setFontSize(8); doc.setTextColor(...GRIS);
  doc.text(textoPdf(`${rango} · emitido el ${fmtDate(new Date().toISOString())}`), W / 2, y + 40, { align: 'center' });
  return y + 58;
}

/**
 * Las tres cifras, en tres cajas.
 *
 * Grandes y arriba porque son la respuesta: el resto de la hoja existe para
 * el que las discuta.
 */
function cajasTotales(doc: any, W: number, M: number, y: number, total: number, pagado: number, debe: number): number {
  const ancho = (W - M * 2 - 16) / 3;
  const alto = 46;
  const cajas: Array<[string, number, [number, number, number]]> = [
    ['Total prestado', total, TINTA],
    ['Total pagado', pagado, VERDE],
    ['Debe', debe, debe > 0 ? ROJO : VERDE],
  ];
  cajas.forEach(([rotulo, valor, color], i) => {
    const x = M + i * (ancho + 8);
    doc.setDrawColor(210, 210, 210); doc.setLineWidth(0.6);
    doc.setFillColor(250, 250, 250);
    doc.roundedRect(x, y, ancho, alto, 3, 3, 'FD');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...GRIS);
    doc.text(textoPdf(rotulo.toUpperCase()), x + ancho / 2, y + 15, { align: 'center' });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(...color);
    doc.text(textoPdf(usd(valor)), x + ancho / 2, y + 34, { align: 'center' });
  });
  return y + alto + 18;
}

/** Pie con la firma de conformidad. Solo en el de una persona. */
function firmas(doc: any, W: number, M: number, H: number) {
  const y = H - 74;
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
    W / 2, H - 30, { align: 'center' },
  );
}

/**
 * Estado de cuenta de UNA persona: cada préstamo con sus abonos.
 *
 * Los abonos van pegados debajo de su préstamo y no en una tabla aparte:
 * separados, nadie puede seguir cuál pagó qué.
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
  const M = 42;
  const emp = definicionEmpresa(normalizarEmpresa(persona.empresa));
  const ec = estadoDeCuenta(persona.id, prestamos, pagos);

  let y = await encabezado(
    doc, W, M,
    'ESTADO DE CUENTA · PRESTAMOS Y ANTICIPOS',
    emp.razonSocial,
    textoRango(rango?.desde, rango?.hasta),
  );

  /* ── Quién es ── */
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...TINTA);
  doc.text(textoPdf(`${persona.nombre} ${persona.apellido ?? ''}`.trim()), M, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GRIS);
  const datos = [
    numeroFicha(persona.numero_ficha),
    persona.cedula ? `C.I. ${persona.cedula}` : '',
    persona.cargo || 'Sin cargo',
    persona.departamento || '',
  ].filter(Boolean).join(' · ');
  doc.text(textoPdf(datos), M, y + 13);
  y += 28;

  y = cajasTotales(doc, W, M, y, ec.total, ec.pagado, ec.debe);

  if (!ec.renglones.length) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...GRIS);
    doc.text(textoPdf('Esta persona no tiene prestamos ni anticipos registrados en el periodo.'), M, y);
    firmas(doc, W, M, H);
    await previewPdfDoc(doc, `estado-cuenta-${(persona.nombre ?? '').toLowerCase()}.pdf`);
    return;
  }

  /* ── Un bloque por préstamo ── */
  for (const r of ec.renglones) {
    // Que un préstamo no arranque al filo de la hoja y sus abonos queden solos
    // en la siguiente: se lee mal y se presta a discusión.
    if (y + 70 > H - 100) { doc.addPage(); y = M; }

    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...NARANJA);
    const titulo = `${r.prestamo.tipo === 'anticipo' ? 'ANTICIPO' : 'PRESTAMO'} · ${fmtDate(fechaDePrestamo(r.prestamo))}`;
    doc.text(textoPdf(titulo), M, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...TINTA);
    doc.text(textoPdf(`${usd(r.prestamo.monto_total)}  ·  pagado ${usd(r.pagado)}  ·  debe ${usd(r.debe)}`), W - M, y, { align: 'right' });
    doc.setDrawColor(...NARANJA); doc.setLineWidth(0.6);
    doc.line(M, y + 4, W - M, y + 4);
    y += 14;

    if (r.prestamo.motivo) {
      doc.setFontSize(8); doc.setTextColor(...GRIS);
      const lineas = doc.splitTextToSize(textoPdf(r.prestamo.motivo), W - M * 2) as string[];
      doc.text(lineas, M, y + 6);
      y += lineas.length * 10 + 4;
    }

    if (r.pagos.length) {
      autoTable(doc as any, {
        startY: y + 4,
        head: [filaPdf(['Fecha del abono', 'Origen', 'Nota', 'Monto'])],
        body: r.pagos.map((p) => filaPdf([fmtDate(p.fecha), labelOrigen(p.origen), p.nota ?? '', usd(p.monto)])),
        theme: 'grid',
        headStyles: { fillColor: [245, 245, 245], textColor: GRIS, fontSize: 7.5, fontStyle: 'bold', lineColor: [215, 215, 215], lineWidth: 0.4 },
        bodyStyles: { fontSize: 8, lineColor: [215, 215, 215], lineWidth: 0.4 },
        columnStyles: { 0: { cellWidth: 95 }, 1: { cellWidth: 85 }, 3: { cellWidth: 80, halign: 'right' } },
        margin: { left: M, right: M },
      });
      y = ((doc as any).lastAutoTable?.finalY ?? y) + 14;
    } else {
      doc.setFontSize(8); doc.setTextColor(...GRIS);
      doc.text(textoPdf('Sin abonos registrados.'), M, y + 10);
      y += 24;
    }
  }

  firmas(doc, W, M, H);
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
  const M = 42;
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
  y = cajasTotales(doc, W, M, y, total, pagado, debe);

  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GRIS);
  const conSaldo = deudas.filter((d) => d.debe > 0).length;
  doc.text(
    textoPdf(`${deudas.length} trabajador(es) con movimientos · ${conSaldo} con saldo pendiente`),
    M, y,
  );
  y += 12;

  autoTable(doc as any, {
    startY: y,
    head: [filaPdf(['Trabajador', 'Prestamos', 'Desde', 'Prestado', 'Pagado', 'Debe'])],
    body: deudas.map((d) => filaPdf([
      d.nombre,
      String(d.prestamos.length),
      d.desde ? fmtDate(d.desde) : '—',
      usd(d.total), usd(d.pagado), usd(d.debe),
    ])),
    foot: [filaPdf(['TOTAL', String(deudas.reduce((a, d) => a + d.prestamos.length, 0)), '', usd(total), usd(pagado), usd(debe)])],
    theme: 'grid',
    headStyles: { fillColor: [245, 245, 245], textColor: GRIS, fontSize: 7.5, fontStyle: 'bold', lineColor: [215, 215, 215], lineWidth: 0.4 },
    footStyles: { fillColor: [250, 240, 225], textColor: TINTA, fontSize: 8.5, fontStyle: 'bold', lineColor: [215, 215, 215], lineWidth: 0.4 },
    bodyStyles: { fontSize: 8.5, lineColor: [215, 215, 215], lineWidth: 0.4 },
    columnStyles: {
      1: { cellWidth: 58, halign: 'center' },
      2: { cellWidth: 70 },
      3: { cellWidth: 75, halign: 'right' },
      4: { cellWidth: 75, halign: 'right' },
      5: { cellWidth: 75, halign: 'right', fontStyle: 'bold' },
    },
    margin: { left: M, right: M },
  });

  await previewPdfDoc(doc, 'prestamos-consolidado.pdf');
}
