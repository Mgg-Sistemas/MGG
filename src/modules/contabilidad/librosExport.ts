/* ============================================================
   MGG · Contabilidad · Los libros en PDF y en Excel (E-03, C37)

   Balance de Comprobación, Mayor Analítico, Movimientos de Auxiliares y
   Diario de Comprobantes, con
   el encabezado impreso de Galac (compañía, título, rango, «Expresado
   en …», emisión) y el estándar de MGG: carta, márgenes de MARGEN_PDF,
   logo y naranja corporativo. Los saldos acreedores, entre paréntesis.

   jsPDF, autoTable y xlsx-js-style se cargan con import() dinámico al
   pulsar el botón, nunca en el import estático. Salida con previewPdfDoc
   y previewWorkbook: NADA se descarga solo.

   Las filas las arman funciones puras (filasBalance, filasMayor,
   filasDiario) que comparten el PDF y el Excel: así las pruebas cubren
   el contenido sin generar archivos.
   ============================================================ */

import { previewPdfDoc, previewWorkbook } from '@/shared/lib/reportPreview';
import { MARGEN_PDF, MARGENES_TABLA_PDF } from '@/shared/lib/pdfMargen';
import { textoPdf } from '@/shared/lib/textoPdf';
import type { EstadoFinanciero } from './logica/estados';
import { nombreTipoAuxiliar } from './logica/catalogos';
import type { AuxiliarMayor, BalanceComprobacion, CuentaMayor, LibroDiario, MonedaInforme } from './logica/reportes';

export interface ContextoLibro {
  empresa: string | null;
  titulo: string;
  /** «Del 01/07/2026 al 30/09/2026». */
  rango: string;
  moneda: MonedaInforme;
  /** Para el nombre del archivo. */
  archivo: string;
  /** Una lista de catálogo no lleva «Expresado en …»: no tiene importes. */
  sinMoneda?: boolean;
}

/** Una fila del informe: título de bloque (texto que ocupa toda la fila), datos o total. */
export type FilaLibro =
  | { tipo: 'bloque'; texto: string }
  | { tipo: 'datos' | 'titulo' | 'total'; celdas: Array<string | number | null> };

const fmt = (v: number) => v.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Galac: acreedor entre paréntesis. */
export const saldoTexto = (v: number) => (v < 0 ? `(${fmt(-v)})` : fmt(v));
const fechaTexto = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
const expresado = (m: MonedaInforme) => `Expresado en ${m === 'VES' ? 'Bolívares' : 'Dólares'}`;

/* ───────────── Filas (puras) ───────────── */

export const COLUMNAS_BALANCE = ['Nombre de la Cuenta', 'Saldo Inicial', 'Monto Debe', 'Monto Haber', 'Saldo Actual'];

export function filasBalance(b: BalanceComprobacion, conCodigo: boolean): FilaLibro[] {
  const filas: FilaLibro[] = b.filas.map((f) => ({
    tipo: f.cuenta.es_movimiento ? 'datos' : 'titulo',
    celdas: [`${'  '.repeat(f.nivel - 1)}${conCodigo ? `${f.cuenta.codigo} - ` : ''}${f.cuenta.nombre}`, f.saldoInicial, f.debe, f.haber, f.saldoActual],
  }));
  filas.push({ tipo: 'total', celdas: ['TOTALES', b.totales.saldoInicial, b.totales.debe, b.totales.haber, b.totales.saldoActual] });
  return filas;
}

export const columnasMayor = (modo: 'detallado' | 'resumido') => modo === 'detallado'
  ? ['Fecha', 'N° Comprobante', 'Referencia', 'Descripción', 'Auxiliar', 'C.C.', 'Debe', 'Haber', 'Saldo']
  : ['Fecha', 'Concepto', 'Debe', 'Haber', 'Saldo'];

export function filasMayor(cuentas: CuentaMayor[], modo: 'detallado' | 'resumido'): FilaLibro[] {
  const vacias = modo === 'detallado' ? 5 : 1;
  const filas: FilaLibro[] = [];
  for (const m of cuentas) {
    filas.push({ tipo: 'bloque', texto: `Cuenta Contable: ${m.cuenta.codigo} - ${m.cuenta.nombre}` });
    filas.push({ tipo: 'titulo', celdas: ['Saldo Inicial', ...Array(vacias).fill(null), null, null, m.saldoInicial] });
    for (const x of m.movimientos) {
      filas.push({
        tipo: 'datos',
        celdas: modo === 'detallado'
          ? [fechaTexto(x.fecha), x.comprobante, x.referencia, x.descripcion, x.auxiliar, x.centro, x.debe || null, x.haber || null, x.saldo]
          : [fechaTexto(x.fecha), `${x.comprobante} · ${x.descripcion}`, x.debe || null, x.haber || null, x.saldo],
      });
    }
    filas.push({ tipo: 'total', celdas: ['TOTALES', ...Array(vacias).fill(null), m.debe, m.haber, m.saldoFinal] });
  }
  return filas;
}

export const COLUMNAS_AUXILIARES = ['Fecha', 'N° Comprobante', 'Cuenta', 'Referencia', 'Descripción', 'Debe', 'Haber', 'Saldo'];

/** Movimientos de Auxiliares: un bloque por tercero, con su saldo inicial, sus renglones y TOTALES. */
export function filasAuxiliares(auxiliares: AuxiliarMayor[]): FilaLibro[] {
  const filas: FilaLibro[] = [];
  for (const a of auxiliares) {
    filas.push({ tipo: 'bloque', texto: `Auxiliar: ${nombreTipoAuxiliar(a.auxiliar.tipo)} ${a.auxiliar.codigo} - ${a.auxiliar.nombre}${a.auxiliar.rif ? ` (${a.auxiliar.rif})` : ''}` });
    filas.push({ tipo: 'titulo', celdas: ['Saldo Inicial', null, null, null, null, null, null, a.saldoInicial] });
    for (const x of a.movimientos) {
      filas.push({ tipo: 'datos', celdas: [fechaTexto(x.fecha), x.comprobante, `${x.cuenta} ${x.nombreCuenta}`, x.referencia, x.descripcion, x.debe || null, x.haber || null, x.saldo] });
    }
    filas.push({ tipo: 'total', celdas: ['TOTALES', null, null, null, null, a.debe, a.haber, a.saldoFinal] });
  }
  return filas;
}

export const COLUMNAS_DIARIO = ['Código', 'Nombre de la Cuenta', 'Referencia', 'Descripción', 'Debe', 'Haber'];

export function filasDiario(d: LibroDiario): FilaLibro[] {
  const filas: FilaLibro[] = [];
  for (const c of d.comprobantes) {
    filas.push({ tipo: 'bloque', texto: `${c.comprobante.codigo} · ${fechaTexto(c.comprobante.fecha)} · ${c.comprobante.concepto}` });
    for (const a of c.asientos) filas.push({ tipo: 'datos', celdas: [a.codigo, a.nombre, a.referencia, a.descripcion, a.debe || null, a.haber || null] });
    filas.push({ tipo: 'total', celdas: ['Total del comprobante', null, null, null, c.debe, c.haber] });
  }
  filas.push({ tipo: 'total', celdas: [`TOTAL GENERAL · ${d.comprobantes.length} comprobantes`, null, null, null, d.debe, d.haber] });
  return filas;
}

/* ───────────── PDF ───────────── */

/** Columnas con saldos (paréntesis) y con montos simples, por informe. */
interface Formato { saldos: number[]; montos: number[]; apaisado?: boolean }

const FORMATO_BALANCE: Formato = { saldos: [1, 4], montos: [2, 3] };
const formatoMayor = (modo: 'detallado' | 'resumido'): Formato => (modo === 'detallado'
  ? { saldos: [8], montos: [6, 7], apaisado: true }
  : { saldos: [4], montos: [2, 3] });
const FORMATO_AUXILIARES: Formato = { saldos: [7], montos: [5, 6], apaisado: true };
const FORMATO_DIARIO: Formato = { saldos: [], montos: [4, 5], apaisado: true };

/* eslint-disable @typescript-eslint/no-explicit-any */
async function generarPdf(ctx: ContextoLibro, columnas: string[], filas: FilaLibro[], f: Formato): Promise<void> {
  const [{ jsPDF }, { default: autoTable }, { loadLogoDataUrl }] = await Promise.all([
    import('jspdf'), import('jspdf-autotable'), import('@/shared/lib/pdfLogo'),
  ]);
  const logo = await loadLogoDataUrl().catch(() => null);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: f.apaisado ? 'landscape' : 'portrait' });
  const W = doc.internal.pageSize.getWidth();
  let y = MARGEN_PDF;
  if (logo) { try { doc.addImage(logo, 'JPEG', MARGEN_PDF, y, 40, 40); } catch { /* el logo es opcional */ } }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(30, 30, 30);
  doc.text(textoPdf(ctx.empresa ?? ''), W / 2, y + 10, { align: 'center' });
  doc.setTextColor(255, 138, 0); doc.setFontSize(14);
  doc.text(textoPdf(ctx.titulo), W / 2, y + 26, { align: 'center' });
  doc.setTextColor(60, 60, 60); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(textoPdf(ctx.rango), W / 2, y + 39, { align: 'center' });
  doc.text(textoPdf(`${ctx.sinMoneda ? '' : `${expresado(ctx.moneda)} · `}Emitido el ${new Date().toLocaleString('es-VE')}`), W / 2, y + 51, { align: 'center' });
  y += 64;

  const celda = (v: string | number | null, i: number) => {
    if (v == null) return '';
    if (typeof v === 'number') return f.saldos.includes(i) ? saldoTexto(v) : fmt(v);
    return textoPdf(v);
  };
  const body = filas.map((fila) => {
    if (fila.tipo === 'bloque') return [{ content: textoPdf(fila.texto), colSpan: columnas.length, styles: { fontStyle: 'bold', fillColor: [245, 245, 245] } }];
    const estilo = fila.tipo === 'datos' ? {} : { fontStyle: 'bold' };
    return fila.celdas.map((v, i) => ({ content: celda(v, i), styles: estilo }));
  });
  const columnStyles: Record<number, any> = {};
  for (const i of [...f.saldos, ...f.montos]) columnStyles[i] = { halign: 'right' };
  autoTable(doc as any, {
    startY: y,
    head: [columnas.map((c) => textoPdf(c))],
    body: body as any,
    styles: { fontSize: 7.5, cellPadding: 3 },
    headStyles: { fillColor: [255, 138, 0], textColor: 255, fontStyle: 'bold' },
    columnStyles,
    margin: MARGENES_TABLA_PDF,
    didDrawPage: () => {
      const h = doc.internal.pageSize.getHeight();
      doc.setFontSize(7); doc.setTextColor(120, 120, 120);
      doc.text(`Pág. ${doc.getNumberOfPages()}`, W - MARGEN_PDF, h - MARGEN_PDF / 2, { align: 'right' });
    },
  });
  previewPdfDoc(doc, `${ctx.archivo}.pdf`);
}

/* ───────────── Excel ───────────── */

const ESTILO_TITULO = { font: { name: 'Arial', sz: 13, bold: true, color: { rgb: 'FF8A00' } } };
const ESTILO_CABECERA = {
  font: { name: 'Arial', sz: 10, bold: true, color: { rgb: 'FFFFFF' } },
  fill: { patternType: 'solid', fgColor: { rgb: 'FF8A00' } },
};
const ESTILO_NEGRITA = { font: { name: 'Arial', sz: 10, bold: true } };
/** Galac: los saldos negativos (acreedores) entre paréntesis. */
const FORMATO_SALDO = '#,##0.00;(#,##0.00)';
const FORMATO_MONTO = '#,##0.00';

async function generarExcel(ctx: ContextoLibro, columnas: string[], filas: FilaLibro[], f: Formato, hoja: string): Promise<void> {
  const XLSXmod = await import('xlsx-js-style');
  const XLSX = (XLSXmod as any).default ?? XLSXmod;
  const encabezado = [[ctx.empresa ?? ''], [ctx.titulo], [ctx.rango], [`${expresado(ctx.moneda)} · Emitido el ${new Date().toLocaleString('es-VE')}`], []];
  const datos = filas.map((fila) => (fila.tipo === 'bloque' ? [fila.texto] : fila.celdas.map((v) => (v == null ? '' : v))));
  const ws = XLSX.utils.aoa_to_sheet([...encabezado, columnas, ...datos]);
  const inicio = encabezado.length + 1;
  const cell = (r: number, c: number) => ws[XLSX.utils.encode_cell({ r, c })];
  ws['!merges'] = [];
  filas.forEach((fila, i) => {
    const r = inicio + i;
    if (fila.tipo === 'bloque') {
      ws['!merges'].push({ s: { r, c: 0 }, e: { r, c: columnas.length - 1 } });
      const c0 = cell(r, 0); if (c0) c0.s = ESTILO_NEGRITA;
      return;
    }
    fila.celdas.forEach((v, c) => {
      const x = cell(r, c);
      if (!x) return;
      if (typeof v === 'number') x.z = f.saldos.includes(c) ? FORMATO_SALDO : FORMATO_MONTO;
      if (fila.tipo !== 'datos') x.s = ESTILO_NEGRITA;
    });
  });
  const t = cell(1, 0); if (t) t.s = ESTILO_TITULO;
  columnas.forEach((_, c) => { const x = cell(encabezado.length, c); if (x) x.s = ESTILO_CABECERA; });
  ws['!cols'] = columnas.map((_, c) => ({ wch: f.saldos.includes(c) || f.montos.includes(c) ? 16 : c === 0 ? 44 : 22 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, hoja);
  previewWorkbook(XLSX, wb, `${ctx.archivo}.xlsx`);
}

/* ───────────── Estados financieros (E-06) ───────────── */

/** Balance General y Estado de Resultados: cada sección con sus cuentas y su total, y los resultados al final. */
/**
 * El estado en filas: sección (bloque), grupo (título), renglón (datos) con sus cuentas si
 * se detallan, total de sección, subtotales y totales finales. Solo la moneda elegida.
 */
export function filasEstado(e: EstadoFinanciero, conCodigo: boolean): FilaLibro[] {
  const filas: FilaLibro[] = [];
  const vacias = e.columnas.map(() => null);
  for (const b of e.bloques) {
    if (b.tipo === 'subtotal') { filas.push({ tipo: 'total', celdas: [b.etiqueta, ...b.valores] }); continue; }
    filas.push({ tipo: 'bloque', texto: b.nombre });
    for (const g of b.grupos) {
      if (g.nombre && g.nombre !== b.nombre) filas.push({ tipo: 'titulo', celdas: [g.nombre, ...vacias] });
      for (const r of g.renglones) {
        filas.push({ tipo: 'datos', celdas: [r.nombre, ...r.valores] });
        for (const x of r.detalle) filas.push({ tipo: 'datos', celdas: [`    ${conCodigo ? `${x.cuenta.codigo} - ` : ''}${x.cuenta.nombre}`, ...x.valores] });
      }
    }
    filas.push({ tipo: 'total', celdas: [b.total.etiqueta, ...b.total.valores] });
  }
  for (const t of e.totales) filas.push({ tipo: 'total', celdas: [t.etiqueta, ...t.valores] });
  return filas;
}

const formatoEstado = (e: EstadoFinanciero): Formato => ({ saldos: e.columnas.map((_, i) => i + 1), montos: [], apaisado: e.columnas.length > 3 });
const columnasEstado = (e: EstadoFinanciero) => ['Cuenta', ...e.columnas.map((x) => x.etiqueta)];

export const verEstadoPdf = (e: EstadoFinanciero, conCodigo: boolean, ctx: ContextoLibro) =>
  generarPdf(ctx, columnasEstado(e), filasEstado(e, conCodigo), formatoEstado(e));
export const verEstadoExcel = (e: EstadoFinanciero, conCodigo: boolean, ctx: ContextoLibro) =>
  generarExcel(ctx, columnasEstado(e), filasEstado(e, conCodigo), formatoEstado(e), ctx.titulo.slice(0, 31));

/* ───────────── Lo que llama la pantalla ───────────── */

export const verBalancePdf = (b: BalanceComprobacion, conCodigo: boolean, ctx: ContextoLibro) =>
  generarPdf(ctx, COLUMNAS_BALANCE, filasBalance(b, conCodigo), FORMATO_BALANCE);
export const verBalanceExcel = (b: BalanceComprobacion, conCodigo: boolean, ctx: ContextoLibro) =>
  generarExcel(ctx, COLUMNAS_BALANCE, filasBalance(b, conCodigo), FORMATO_BALANCE, 'Balance de Comprobación');

export const verMayorPdf = (m: CuentaMayor[], modo: 'detallado' | 'resumido', ctx: ContextoLibro) =>
  generarPdf(ctx, columnasMayor(modo), filasMayor(m, modo), formatoMayor(modo));
export const verMayorExcel = (m: CuentaMayor[], modo: 'detallado' | 'resumido', ctx: ContextoLibro) =>
  generarExcel(ctx, columnasMayor(modo), filasMayor(m, modo), formatoMayor(modo), 'Mayor Analítico');

export const verDiarioPdf = (d: LibroDiario, ctx: ContextoLibro) => generarPdf(ctx, COLUMNAS_DIARIO, filasDiario(d), FORMATO_DIARIO);
export const verDiarioExcel = (d: LibroDiario, ctx: ContextoLibro) => generarExcel(ctx, COLUMNAS_DIARIO, filasDiario(d), FORMATO_DIARIO, 'Diario de Comprobantes');

export const verAuxiliaresPdf = (a: AuxiliarMayor[], ctx: ContextoLibro) => generarPdf(ctx, COLUMNAS_AUXILIARES, filasAuxiliares(a), FORMATO_AUXILIARES);
export const verAuxiliaresExcel = (a: AuxiliarMayor[], ctx: ContextoLibro) =>
  generarExcel(ctx, COLUMNAS_AUXILIARES, filasAuxiliares(a), FORMATO_AUXILIARES, 'Movimientos de Auxiliares');

/** «Imprimir Lista» de la ventana de catálogos: la rejilla tal como se ve (con el filtro de Buscar). */
export const verListaPdf = (ctx: ContextoLibro, columnas: string[], filas: string[][], numericas: number[]) =>
  generarPdf({ ...ctx, sinMoneda: true }, columnas, filas.map((celdas) => ({ tipo: 'datos', celdas })), { saldos: [], montos: numericas, apaisado: columnas.length > 5 });
