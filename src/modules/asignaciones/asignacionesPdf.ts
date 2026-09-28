/* ============================================================
   MGG · Asignaciones · Reportes en PDF

   Dos documentos con el mismo formato:

   · El HISTÓRICO DE UNA PERSONA, que es lo que se imprime y se firma
     cuando alguien entra (se le entregó esto) y cuando se va (esto
     tiene que devolver). Lo pendiente va arriba y destacado: es lo
     único que hay que reclamar antes de firmar la liquidación.
   · El CONSOLIDADO de lo que se está mirando en pantalla, con el
     mismo filtro y el mismo rango de fechas.

   Solo vista previa, por botón: acá nunca se descarga nada solo.
   ============================================================ */
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import { textoPdf, filaPdf } from '@/shared/lib/textoPdf';
import { date as fmtDate } from '@/shared/lib/format';
import type { Asignacion, Personal } from '@/shared/lib/types';
import { numeroFicha } from '@/modules/rrhh/fichaPersonal';
import {
  conteoPorTipo, estaPendiente, labelTipo, textoEstado,
} from './asignaciones';

const NARANJA: [number, number, number] = [255, 138, 0];
const GRIS: [number, number, number] = [120, 120, 120];
const TINTA: [number, number, number] = [40, 40, 40];
const ROJO: [number, number, number] = [200, 60, 60];
const VERDE: [number, number, number] = [40, 150, 90];

/** El rango que se está mirando, para el encabezado. */
function textoRango(desde?: string | null, hasta?: string | null): string {
  if (desde && hasta) return `Del ${fmtDate(desde)} al ${fmtDate(hasta)}`;
  if (desde) return `Desde el ${fmtDate(desde)}`;
  if (hasta) return `Hasta el ${fmtDate(hasta)}`;
  return 'Todo el historial';
}

/** Cómo se nombra lo asignado en una fila: la descripción y lo que la identifica. */
function detalleDe(a: Asignacion): string {
  const extra = [
    a.serial ? `S/N ${a.serial}` : '',
    a.numero_linea ? `Línea ${a.numero_linea}` : '',
    Number(a.cantidad) > 1 ? `${a.cantidad} ${a.unidad ?? 'und'}` : '',
  ].filter(Boolean).join(' · ');
  return extra ? `${a.descripcion} (${extra})` : a.descripcion;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Encabezado común: logo, título y el rango que se está mirando. */
async function encabezado(doc: any, W: number, M: number, titulo: string, sub: string, rango: string): Promise<number> {
  const { loadLogoDataUrl } = await import('@/shared/lib/pdfLogo');
  const logo = await loadLogoDataUrl().catch(() => null);
  const y = M;
  if (logo) { try { doc.addImage(logo, 'JPEG', M, y, 42, 42); } catch { /* el logo es opcional */ } }
  doc.setTextColor(...NARANJA); doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
  doc.text(textoPdf(titulo), W / 2, y + 14, { align: 'center' });
  doc.setTextColor(60, 60, 60); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(textoPdf(sub), W / 2, y + 28, { align: 'center' });
  doc.setFontSize(8); doc.setTextColor(...GRIS);
  doc.text(textoPdf(`${rango} · emitido el ${fmtDate(new Date().toISOString())}`), W / 2, y + 40, { align: 'center' });
  return y + 58;
}

/** Las dos firmas del pie: quien recibe y quien entrega. */
function firmas(doc: any, W: number, M: number, H: number, nota: string): void {
  const y = H - 78;
  const ancho = (W - M * 2 - 40) / 2;
  doc.setDrawColor(...GRIS); doc.setLineWidth(0.6);
  doc.line(M, y, M + ancho, y);
  doc.line(W - M - ancho, y, W - M, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GRIS);
  doc.text(textoPdf('Firma del trabajador'), M + ancho / 2, y + 12, { align: 'center' });
  doc.text(textoPdf('Por la empresa'), W - M - ancho / 2, y + 12, { align: 'center' });
  doc.setFontSize(7);
  doc.text(textoPdf(nota), W / 2, H - 30, { align: 'center' });
}

/**
 * Las tres cifras, en tres cajas.
 *
 * Grandes y arriba porque son la respuesta: cuántas cosas se le dieron, cuántas
 * tiene que devolver y cuántas ya se cerraron.
 */
function cajasTotales(doc: any, W: number, M: number, y: number, total: number, pendientes: number, cerradas: number): number {
  const ancho = (W - M * 2 - 16) / 3;
  const alto = 46;
  const cajas: Array<[string, number, [number, number, number]]> = [
    ['Asignaciones', total, TINTA],
    ['Por devolver', pendientes, pendientes > 0 ? ROJO : VERDE],
    ['Cerradas', cerradas, GRIS],
  ];
  cajas.forEach(([rotulo, valor, color], i) => {
    const x = M + i * (ancho + 8);
    doc.setDrawColor(225, 225, 225); doc.setLineWidth(0.8);
    doc.roundedRect(x, y, ancho, alto, 4, 4);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...GRIS);
    doc.text(textoPdf(rotulo.toUpperCase()), x + 10, y + 15);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(...color);
    doc.text(String(valor), x + 10, y + 36);
  });
  return y + alto + 18;
}

/**
 * Histórico de UNA persona: todo lo que se le asignó, con lo pendiente arriba.
 *
 * Es el papel que se firma al entrar y al salir. Lo pendiente va primero y en
 * rojo porque es lo accionable; el resto está para el que lo discuta.
 */
export async function verHistorialAsignacionesPdf(
  persona: Personal,
  filas: Asignacion[],
  rango?: { desde?: string | null; hasta?: string | null },
): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 42;

  let y = await encabezado(
    doc, W, M,
    'HISTORICO DE ASIGNACIONES',
    'Mineral Group Guayana, C.A.',
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

  const pendientes = filas.filter(estaPendiente);
  const cerradas = filas.filter((a) => !estaPendiente(a));
  y = cajasTotales(doc, W, M, y, filas.length, pendientes.length, filas.length - pendientes.length);

  if (!filas.length) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...GRIS);
    doc.text(textoPdf('Esta persona no tiene asignaciones registradas en el periodo.'), M, y);
    firmas(doc, W, M, H, 'Documento emitido por el sistema MGG. Refleja el estado a la fecha de emision.');
    previewPdfDoc(doc, `asignaciones-${(persona.nombre ?? '').toLowerCase()}.pdf`);
    return;
  }

  /** Una tabla con título, para no repetir doce líneas dos veces. */
  const tabla = (titulo: string, color: [number, number, number], lista: Asignacion[], conRetorno: boolean) => {
    if (!lista.length) return;
    // Que un título no quede solo al filo de la hoja con su tabla en la siguiente.
    if (y + 60 > H - 110) { doc.addPage(); y = M; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...color);
    doc.text(textoPdf(titulo), M, y);
    doc.setDrawColor(...color); doc.setLineWidth(0.6);
    doc.line(M, y + 4, W - M, y + 4);
    y += 12;

    autoTable(doc as any, {
      startY: y,
      head: [filaPdf(conRetorno
        ? ['Fecha', 'Tipo', 'Lo asignado', 'Devuelto', 'Estado']
        : ['Fecha', 'Tipo', 'Lo asignado', 'Estado'])],
      body: lista.map((a) => filaPdf(conRetorno
        ? [fmtDate(a.fecha_asignacion), labelTipo(a.tipo), detalleDe(a),
           a.fecha_retorno ? fmtDate(a.fecha_retorno) : '—', textoEstado(a.estado, a.retornable)]
        : [fmtDate(a.fecha_asignacion), labelTipo(a.tipo), detalleDe(a),
           textoEstado(a.estado, a.retornable)])),
      styles: { fontSize: 7.5, cellPadding: 3 },
      headStyles: { fillColor: color, textColor: 255, fontStyle: 'bold' },
      margin: { left: M, right: M, bottom: 100 },
      theme: 'grid',
    });
    y = ((doc as any).lastAutoTable?.finalY ?? y) + 18;
  };

  tabla('PENDIENTE DE DEVOLUCION', ROJO, pendientes, false);
  tabla('YA CERRADO', GRIS, cerradas, true);

  firmas(doc, W, M, H,
    'Lo pendiente de devolucion debe entregarse antes de la liquidacion. Este documento refleja el estado a la fecha de emision.');
  previewPdfDoc(doc, `asignaciones-${(persona.nombre ?? '').toLowerCase()}.pdf`);
}

/**
 * Consolidado de lo que se está viendo en pantalla.
 *
 * Sale con el MISMO filtro que la tabla: si el reporte mostrara otra cosa que
 * la pantalla, nadie podría confiar en ninguno de los dos.
 */
export async function verConsolidadoAsignacionesPdf(
  filas: Asignacion[],
  nombrePersonal: (id: string | null | undefined) => string,
  rango?: { desde?: string | null; hasta?: string | null },
): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 36;

  let y = await encabezado(
    doc, W, M,
    'ASIGNACIONES AL PERSONAL',
    'Mineral Group Guayana, C.A.',
    textoRango(rango?.desde, rango?.hasta),
  );

  const pendientes = filas.filter(estaPendiente).length;
  y = cajasTotales(doc, W, M, y, filas.length, pendientes, filas.length - pendientes);

  if (!filas.length) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...GRIS);
    doc.text(textoPdf('No hay asignaciones con los filtros elegidos.'), M, y);
    previewPdfDoc(doc, 'asignaciones-consolidado.pdf');
    return;
  }

  /* ── Cuántas de cada tipo ── */
  const porTipo = conteoPorTipo(filas);
  if (porTipo.length) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GRIS);
    doc.text(textoPdf(porTipo.map((t) => `${t.label}: ${t.cantidad}`).join('   ·   ')), M, y);
    y += 16;
  }

  autoTable(doc as any, {
    startY: y,
    head: [filaPdf(['Fecha', 'Trabajador', 'Tipo', 'Lo asignado', 'Almacen', 'Devuelto', 'Estado'])],
    body: filas.map((a) => filaPdf([
      fmtDate(a.fecha_asignacion),
      nombrePersonal(a.personal_id),
      labelTipo(a.tipo),
      detalleDe(a),
      a.almacen ?? '—',
      a.fecha_retorno ? fmtDate(a.fecha_retorno) : '—',
      textoEstado(a.estado, a.retornable),
    ])),
    styles: { fontSize: 7.5, cellPadding: 3 },
    headStyles: { fillColor: NARANJA, textColor: 255, fontStyle: 'bold' },
    // Lo pendiente en rojo: es lo único accionable de la hoja.
    didParseCell: (d: any) => {
      if (d.section !== 'body') return;
      const fila = filas[d.row.index];
      if (fila && estaPendiente(fila)) d.cell.styles.textColor = ROJO;
    },
    margin: { left: M, right: M, bottom: 40 },
    theme: 'grid',
  });

  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...GRIS);
  doc.text(
    textoPdf('En rojo, lo que esta pendiente de devolucion. La dotacion y el material de oficina no retornan.'),
    W / 2, H - 20, { align: 'center' },
  );
  previewPdfDoc(doc, 'asignaciones-consolidado.pdf');
}
