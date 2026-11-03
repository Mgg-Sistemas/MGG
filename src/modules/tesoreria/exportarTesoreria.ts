/* ============================================================
   MGG · Tesorería · Exportación del Reporte de Tesorería (03-11-2026)
   Traído de Golden Touch (exportarTesoreria.ts, 02-11-2026), con el membrete
   y la vista previa de MGG:
   - PDF (jsPDF + autotable): membrete MGG, barra naranja, tarjetas de KPIs y
     dos formatos: Fichas ejecutivas (borde por tipo de flujo) o Tabla. Se abre
     en la vista previa del sistema (reportPreview.ts); solo baja con «Descargar».
   - Excel (ExcelJS): hoja «Resumen» (KPIs + top categorías/proveedores) y hoja
     de datos con cabecera naranja, totales y vista congelada; también pasa por
     la vista previa antes de bajar.
   - CSV: plano con BOM UTF-8 y separador ';' (Excel en español), protegido
     contra fórmulas inyectadas.
   Todo se genera SOLO cuando el usuario toca el botón. Los montos en USD salen
   solo si el interruptor de USD está activo; los de Bs, solo si lo está el de Bs.
   ============================================================ */

import { previewPdfDoc } from '@/shared/lib/reportPreview';
import { previewExcelArchivo } from '@/shared/lib/reportePreview';
import { pdfSafe } from '@/shared/lib/pdfSafe';
import { identidadEmpresa } from '@/shared/lib/empresa';
import { loadLogoPdfEmpresa, dibujarLogoPdf, anchoLogoPdf } from '@/shared/lib/pdfLogo';
import type {
  FilaReporteTesoreria,
  ResumenReporteTesoreria,
  CampoColumnaTesoreria,
  ModoAgrupacionTesoreria,
  AmbitoTesoreria,
  BaseTasaTesoreria,
  OrdenReporteTesoreria,
  TipoFlujoTesoreria,
} from './reporteTesoreriaMoldeable';
import { CAMPOS_REPORTE_TESORERIA, ETIQUETA_FLUJO, obtenerMetricasFichaTesoreria } from './reporteTesoreriaMoldeable';

const NARANJA: [number, number, number] = [255, 138, 0];
const VERDE: [number, number, number] = [16, 185, 129];
const AZUL: [number, number, number] = [56, 189, 248];
const TINTA: [number, number, number] = [30, 41, 59];
const BORDE: [number, number, number] = [203, 213, 225];
const FONDO_ALT: [number, number, number] = [250, 246, 240];

/** Color del borde/acento de una ficha según el tipo de flujo. */
const COLOR_FLUJO: Record<TipoFlujoTesoreria, [number, number, number]> = {
  egreso: NARANJA,
  ingreso: VERDE,
  traslado: AZUL,
};

const fmtNum = (v: number | null | undefined, dec = 2) =>
  v == null ? '-' : Number(v).toLocaleString('es-VE', { minimumFractionDigits: 0, maximumFractionDigits: dec });
const fmtUsd = (v: number | null | undefined) =>
  v == null ? '-' : `$ ${Number(v).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtBs = (v: number | null | undefined) =>
  v == null ? '-' : `Bs ${Number(v).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPct = (v: number | null | undefined) =>
  v == null ? '-' : `${Number(v).toFixed(1)} %`;

/** dd/mm/aaaa a partir de YYYY-MM-DD. */
export function fmtFechaReporte(f: string): string {
  const [y, m, d] = (f || '').split('-');
  return y && m && d ? `${d}/${m}/${y}` : f || '-';
}

const hoyStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas' }).format(new Date());

export const TITULO_AMBITO_REPORTE: Record<AmbitoTesoreria, string> = {
  movimientos: 'Reporte de movimientos de Tesorería',
  por_pagar: 'Pendientes por pagar',
  creditos_cartera: 'Cuentas a crédito (cartera)',
};

const ETIQUETA_AGRUPACION: Record<ModoAgrupacionTesoreria, string> = {
  caja: 'Caja', moneda: 'Moneda', tipo_movimiento: 'Tipo', categoria_gasto: 'Categoría',
  contraparte: 'Proveedor', origen_documento: 'Documento', dia: 'Día', mes: 'Mes', detallado: 'Detallado',
};

export interface MetadatosExportacionTesoreria {
  desde: string;
  hasta: string;
  ambito: AmbitoTesoreria;
  agrupacion: ModoAgrupacionTesoreria;
  baseTasa: BaseTasaTesoreria;
  mostrarUsd: boolean;
  mostrarBs: boolean;
  subtituloFiltros?: string;
  incluirResumen: boolean;
  orientacion?: 'auto' | 'portrait' | 'landscape';
  formatoPresentacion?: 'fichas' | 'tabla';
  ordenarPor?: OrdenReporteTesoreria;
  /** KPIs en vista simple: dos tarjetas «Total $ / Total Bs» (bruto) en vez del detalle. */
  kpisSimplificados?: boolean;
}

/** Nombre del archivo: tesoreria-<ámbito>-<fecha>.<ext>. */
export function nombreArchivoTesoreria(ambito: AmbitoTesoreria, ext: 'pdf' | 'xlsx' | 'csv', hoy: string = hoyStr()): string {
  return `tesoreria-${ambito.replace(/_/g, '-')}-${hoy}.${ext}`;
}

/** Total bruto por moneda: egresos + ingresos (sirve para los 3 ámbitos). */
function kpisSimples(resumen: ResumenReporteTesoreria, meta: MetadatosExportacionTesoreria): Array<{ label: string; val: string }> {
  const kpis: Array<{ label: string; val: string }> = [];
  if (meta.mostrarUsd) kpis.push({ label: 'TOTAL $', val: fmtUsd(resumen.totalEgresosUsd + resumen.totalIngresosUsd) });
  if (meta.mostrarBs) kpis.push({ label: 'TOTAL Bs', val: fmtBs(resumen.totalEgresosBs + resumen.totalIngresosBs) });
  return kpis;
}

/** Valor crudo de una columna (resuelve clave → campo de la fila). */
function rawDeColumna(f: FilaReporteTesoreria, clave: string): unknown {
  switch (clave) {
    case 'caja': return f.caja_origen;
    case 'tipo_mov': return ETIQUETA_FLUJO[f.tipo_movimiento];
    case 'tasa_bcv': return f.tasa_bcv_aplicada;
    case 'pct_total': return f.pct_del_total;
    case 'saldo_caja': return f.saldo_caja_momento;
    default: return (f as unknown as Record<string, unknown>)[clave];
  }
}

/** El número de una columna numérica (Excel/CSV), o null si no aplica. */
function numeroDeColumna(f: FilaReporteTesoreria, clave: string): number | null {
  switch (clave) {
    case 'monto_usd': return f.monto_usd;
    case 'monto_bs': return f.monto_bs;
    case 'monto_original': return f.monto_original;
    case 'tasa_bcv': return f.tasa_bcv_aplicada;
    case 'pct_total': return f.pct_del_total ?? null;
    case 'saldo_caja': return f.saldo_caja_momento ?? null;
    default: return null;
  }
}

/** Texto formateado de una celda (pantalla, PDF). */
export function textoCeldaTesoreria(f: FilaReporteTesoreria, col: CampoColumnaTesoreria): string {
  const val = rawDeColumna(f, col.clave);
  if (val == null || val === '') return '-';
  switch (col.formato) {
    case 'moneda': return fmtUsd(Number(val));
    case 'moneda_bs': return fmtBs(Number(val));
    case 'numero': return fmtNum(Number(val), 2);
    case 'porcentaje': return fmtPct(Number(val));
    default:
      if (col.clave === 'fecha') return fmtFechaReporte(String(val));
      return String(val);
  }
}

/** Columnas seleccionadas (en el orden del catálogo), respetando los interruptores de moneda. */
export function columnasVisiblesTesoreria(columnasClaves: string[], meta: { mostrarUsd: boolean; mostrarBs: boolean }): CampoColumnaTesoreria[] {
  return CAMPOS_REPORTE_TESORERIA.filter((c) => {
    if (!columnasClaves.includes(c.clave)) return false;
    if (c.clave === 'monto_usd' && !meta.mostrarUsd) return false;
    if (c.clave === 'monto_bs' && !meta.mostrarBs) return false;
    return true;
  });
}

/* ============================================================
   1. EXCEL (ExcelJS)
   ============================================================ */

export async function descargarTesoreriaExcel(
  filas: FilaReporteTesoreria[],
  resumen: ResumenReporteTesoreria,
  columnasClaves: string[],
  meta: MetadatosExportacionTesoreria,
): Promise<void> {
  const columnas = columnasVisiblesTesoreria(columnasClaves, meta);
  if (!columnas.length) throw new Error('Marca al menos una columna.');
  if (!filas.length) throw new Error('No hay datos para exportar.');

  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const idEmp = identidadEmpresa();
  wb.creator = idEmp.nombre;
  wb.created = new Date();

  // 1. Hoja de datos (va primero: es la que muestra la vista previa)
  const orient = meta.orientacion === 'portrait' ? 'portrait' : meta.orientacion === 'landscape' ? 'landscape' : columnas.length > 7 ? 'landscape' : 'portrait';
  const ws = wb.addWorksheet('Tesorería', {
    pageSetup: { orientation: orient, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ state: 'frozen', ySplit: 5 }],
  });
  ws.columns = [{ width: 4 }, ...columnas.map((c) => ({ width: Math.max(c.anchoExcel, c.etiqueta.length + 4) }))];

  ws.mergeCells(2, 2, 2, columnas.length + 1);
  const tit = ws.getCell(2, 2);
  tit.value = `${idEmp.nombre} · ${TITULO_AMBITO_REPORTE[meta.ambito].toUpperCase()}`;
  tit.font = { name: 'Arial', size: 13, bold: true, color: { argb: 'FFFF8A00' } };

  ws.mergeCells(3, 2, 3, columnas.length + 1);
  const sub = ws.getCell(3, 2);
  sub.value = `Período: ${fmtFechaReporte(meta.desde)} al ${fmtFechaReporte(meta.hasta)} | Agrupado por: ${ETIQUETA_AGRUPACION[meta.agrupacion]}${meta.subtituloFiltros ? ` | ${meta.subtituloFiltros}` : ''} | Tasa BCV: ${fmtNum(resumen.tasaBcvReferencia, 2)} Bs/$ ${meta.baseTasa === 'historica' ? '(histórica)' : '(del día)'}`;
  sub.font = { name: 'Arial', size: 8.5, italic: true, color: { argb: 'FF64748B' } };

  const headerRow = ws.getRow(5);
  headerRow.height = 24;
  columnas.forEach((col, idx) => {
    const cell = headerRow.getCell(idx + 2);
    cell.value = col.etiqueta;
    cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF8A00' } };
    cell.alignment = { horizontal: col.alineacion, vertical: 'middle', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      bottom: { style: 'medium', color: { argb: 'FFE2E8F0' } },
      left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    };
  });

  filas.forEach((f, fIdx) => {
    const r = ws.getRow(6 + fIdx);
    r.height = 18;
    const esPar = fIdx % 2 === 1;
    columnas.forEach((col, cIdx) => {
      const cell = r.getCell(cIdx + 2);
      if (col.formato === 'moneda' || col.formato === 'moneda_bs' || col.formato === 'numero') {
        const n = numeroDeColumna(f, col.clave);
        cell.value = n ?? 0;
        cell.numFmt = col.formato === 'moneda' ? '"$"#,##0.00' : col.formato === 'moneda_bs' ? '"Bs "#,##0.00' : '#,##0.00';
      } else if (col.formato === 'porcentaje') {
        const n = numeroDeColumna(f, col.clave);
        cell.value = n != null ? n / 100 : 0;
        cell.numFmt = '0.0%';
      } else {
        const raw = rawDeColumna(f, col.clave);
        cell.value = col.clave === 'fecha' ? fmtFechaReporte(String(raw ?? '')) : (raw != null && raw !== '' ? String(raw) : '-');
      }
      cell.font = { name: 'Arial', size: 8.5, color: { argb: 'FF1E293B' } };
      cell.alignment = { horizontal: col.alineacion, vertical: 'middle' };
      if (esPar) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAF6F0' } };
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      };
    });
  });

  // Totales (suma de las filas mostradas)
  const totUsd = filas.reduce((a, f) => a + (f.monto_usd || 0), 0);
  const totBs = filas.reduce((a, f) => a + (f.monto_bs || 0), 0);
  const totRow = ws.getRow(6 + filas.length);
  totRow.height = 22;
  columnas.forEach((col, cIdx) => {
    const cell = totRow.getCell(cIdx + 2);
    cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF1E293B' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    cell.border = {
      top: { style: 'medium', color: { argb: 'FF94A3B8' } },
      bottom: { style: 'double', color: { argb: 'FF94A3B8' } },
      left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    };
    cell.alignment = { horizontal: col.alineacion, vertical: 'middle' };
    if (col.clave === 'monto_usd') { cell.value = totUsd; cell.numFmt = '"$"#,##0.00'; }
    else if (col.clave === 'monto_bs') { cell.value = totBs; cell.numFmt = '"Bs "#,##0.00'; }
    else if (cIdx === 0) cell.value = 'TOTALES';
  });

  // 2. Hoja Resumen
  if (meta.incluirResumen) {
    const wr = wb.addWorksheet('Resumen', { views: [{ showGridLines: true }] });
    wr.columns = [{ width: 5 }, { width: 28 }, { width: 22 }, { width: 22 }, { width: 22 }];

    wr.mergeCells('B2:E2');
    const r2 = wr.getCell('B2');
    r2.value = `${idEmp.nombre} · RESUMEN DE TESORERÍA`;
    r2.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFF8A00' } };

    wr.mergeCells('B3:E3');
    const r3 = wr.getCell('B3');
    r3.value = `${TITULO_AMBITO_REPORTE[meta.ambito]} | Período: ${fmtFechaReporte(meta.desde)} al ${fmtFechaReporte(meta.hasta)} | Emitido: ${new Date().toLocaleString('es-VE')}`;
    r3.font = { name: 'Arial', size: 9, italic: true, color: { argb: 'FF64748B' } };

    const kpis: Array<{ label: string; val: string }> = [];
    if (meta.kpisSimplificados) {
      kpis.push(...kpisSimples(resumen, meta));
    } else {
      if (meta.mostrarUsd) {
        kpis.push({ label: 'EGRESOS ($ USD)', val: fmtUsd(resumen.totalEgresosUsd) });
        kpis.push({ label: 'INGRESOS ($ USD)', val: fmtUsd(resumen.totalIngresosUsd) });
      }
      if (meta.mostrarBs) {
        kpis.push({ label: 'EGRESOS (Bs)', val: fmtBs(resumen.totalEgresosBs) });
        kpis.push({ label: 'INGRESOS (Bs)', val: fmtBs(resumen.totalIngresosBs) });
      }
      if (kpis.length < 4) kpis.push({ label: 'SALDO NETO', val: meta.mostrarUsd ? fmtUsd(resumen.saldoNetoUsd) : fmtBs(resumen.saldoNetoBs) });
    }

    const bordeFino = { style: 'thin' as const, color: { argb: 'FFCBD5E1' } };
    kpis.slice(0, 4).forEach((k, i) => {
      const colLetter = String.fromCharCode(66 + i);
      const label = wr.getCell(`${colLetter}5`);
      label.value = k.label;
      label.font = { name: 'Arial', size: 8, bold: true, color: { argb: 'FF475569' } };
      label.alignment = { horizontal: 'center', vertical: 'middle' };
      label.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      label.border = { left: bordeFino, right: bordeFino, top: bordeFino };
      const val = wr.getCell(`${colLetter}6`);
      val.value = k.val;
      val.font = { name: 'Arial', size: 13, bold: true, color: { argb: 'FFFF8A00' } };
      val.alignment = { horizontal: 'center', vertical: 'middle' };
      val.border = { left: bordeFino, right: bordeFino, bottom: bordeFino };
    });

    const tablaTop = (filaTitulo: number, titulo: string, encabezado: string, items: ResumenReporteTesoreria['topCategorias']) => {
      wr.getCell(`B${filaTitulo}`).value = titulo;
      wr.getCell(`B${filaTitulo}`).font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF1E293B' } };
      const head = wr.getRow(filaTitulo + 1);
      ['#', encabezado, 'Monto ($)', '% del Total'].forEach((t, i) => {
        const c = head.getCell(i + 2);
        c.value = t;
        c.font = { name: 'Arial', size: 8.5, bold: true, color: { argb: 'FFFFFFFF' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF8A00' } };
        c.alignment = { horizontal: i === 1 ? 'left' : 'center' };
      });
      items.forEach((it, idx) => {
        const r = wr.getRow(filaTitulo + 2 + idx);
        r.getCell(2).value = idx + 1;
        r.getCell(3).value = it.nombre;
        r.getCell(4).value = it.montoUsd;
        r.getCell(4).numFmt = '"$"#,##0.00';
        r.getCell(5).value = it.porcentaje / 100;
        r.getCell(5).numFmt = '0.0%';
        for (let c = 2; c <= 5; c++) {
          r.getCell(c).font = { name: 'Arial', size: 8.5, color: { argb: 'FF334155' } };
          r.getCell(c).border = { bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
        }
      });
      return filaTitulo + 2 + items.length + 1;
    };
    const sig = tablaTop(8, 'TOP CATEGORÍAS (EGRESOS)', 'Categoría', resumen.topCategorias);
    tablaTop(sig, 'TOP PROVEEDORES / BENEFICIARIOS (EGRESOS)', 'Proveedor', resumen.topProveedores);
  }

  const bytes = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  await previewExcelArchivo(bytes, nombreArchivoTesoreria(meta.ambito, 'xlsx'));
}

/* ============================================================
   2. PDF (jsPDF + autotable)
   ============================================================ */

export async function descargarTesoreriaPdf(
  filas: FilaReporteTesoreria[],
  resumen: ResumenReporteTesoreria,
  columnasClaves: string[],
  meta: MetadatosExportacionTesoreria,
): Promise<void> {
  const columnas = columnasVisiblesTesoreria(columnasClaves, meta);
  if (!columnas.length) throw new Error('Marca al menos una columna.');
  if (!filas.length) throw new Error('No hay datos de Tesorería para el período seleccionado.');

  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);

  const esFichas = meta.formatoPresentacion !== 'tabla';
  const orient = meta.orientacion === 'portrait'
    ? 'portrait'
    : meta.orientacion === 'landscape'
      ? 'landscape'
      : esFichas || columnas.length > 6 ? 'landscape' : 'portrait';

  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: orient });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 36;
  const UW = W - M * 2;
  let y = M;

  const idEmp = identidadEmpresa();
  const logo = await loadLogoPdfEmpresa().catch(() => null);

  // 1. Membrete
  const cajaLogo = 40;
  if (logo) dibujarLogoPdf(doc, logo, M, y, cajaLogo);
  const tx = logo ? M + anchoLogoPdf(cajaLogo) + 12 : M;
  const anchoTexto = W - M - tx;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(...NARANJA);
  const titLineas = doc.splitTextToSize(TITULO_AMBITO_REPORTE[meta.ambito], anchoTexto) as string[];
  doc.text(titLineas, tx, y + 14);

  let yy = y + 14 + (titLineas.length - 1) * 14;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(80, 80, 80);
  const partesSub = [
    `${idEmp.nombre} · RIF ${idEmp.rif}`,
    `Período: ${fmtFechaReporte(meta.desde)} al ${fmtFechaReporte(meta.hasta)}`,
    `Agrupado por: ${ETIQUETA_AGRUPACION[meta.agrupacion]}`,
    `Tasa BCV: ${fmtNum(resumen.tasaBcvReferencia, 2)} Bs/$ ${meta.baseTasa === 'historica' ? '(histórica)' : '(del día)'}`,
    `${filas.length} registros`,
  ];
  if (meta.subtituloFiltros) partesSub.push(meta.subtituloFiltros);
  const subLineas = doc.splitTextToSize(pdfSafe(partesSub.join(' · ')), anchoTexto) as string[];
  doc.text(subLineas, tx, yy + 12);
  yy += 12 + (subLineas.length - 1) * 10;

  y = Math.max(y + cajaLogo + 6, yy + 14);
  doc.setDrawColor(...NARANJA);
  doc.setLineWidth(1.4);
  doc.line(M, y, W - M, y);
  y += 12;

  // 2. Tarjetas de KPIs
  if (meta.incluirResumen) {
    const kpis: Array<{ label: string; val: string; sub?: string }> = [];
    if (meta.kpisSimplificados) {
      kpisSimples(resumen, meta).forEach((k, i) => kpis.push(i === 0 ? { ...k, sub: `${resumen.totalOperaciones} operaciones` } : k));
    } else {
      if (meta.mostrarUsd) {
        kpis.push({ label: 'EGRESOS ($ USD)', val: fmtUsd(resumen.totalEgresosUsd), sub: `${resumen.totalOperaciones} operaciones` });
        kpis.push({ label: 'INGRESOS ($ USD)', val: fmtUsd(resumen.totalIngresosUsd), sub: `Neto: ${fmtUsd(resumen.saldoNetoUsd)}` });
      }
      if (meta.mostrarBs) {
        kpis.push({ label: 'EGRESOS (Bs)', val: fmtBs(resumen.totalEgresosBs) });
        kpis.push({ label: 'INGRESOS (Bs)', val: fmtBs(resumen.totalIngresosBs), sub: `Neto: ${fmtBs(resumen.saldoNetoBs)}` });
      }
      if (kpis.length < 4) {
        kpis.push({
          label: 'TASA BCV',
          val: resumen.tasaBcvReferencia > 0 ? `Bs ${fmtNum(resumen.tasaBcvReferencia, 2)}/$` : '-',
          sub: `${resumen.totalOperaciones} operaciones`,
        });
      }
    }

    const cards = kpis.slice(0, 4);
    if (cards.length > 0) {
      const cardGap = 8;
      const cardW = (UW - cardGap * (cards.length - 1)) / cards.length;
      const cardH = 38;
      cards.forEach((k, i) => {
        const cx = M + i * (cardW + cardGap);
        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(...BORDE);
        doc.setLineWidth(0.6);
        doc.roundedRect(cx, y, cardW, cardH, 4, 4, 'FD');
        doc.setFillColor(...NARANJA);
        doc.rect(cx, y + 1, 3, cardH - 2, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.8);
        doc.setTextColor(71, 85, 105);
        doc.text(pdfSafe(k.label), cx + 8, y + 10);
        doc.setFontSize(11);
        doc.setTextColor(...NARANJA);
        doc.text(pdfSafe(k.val), cx + 8, y + 24);
        if (k.sub) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(6.5);
          doc.setTextColor(148, 163, 184);
          doc.text(pdfSafe(k.sub), cx + 8, y + 33);
        }
      });
      y += cardH + 12;
    }
  }

  // 3. Fichas o tabla
  if (esFichas) {
    const cols = orient === 'landscape' ? 2 : 1;
    const cardGap = 10;
    const cardW = (UW - (cols - 1) * cardGap) / cols;
    const cardH = orient === 'landscape' ? 76 : 68;

    const recortar = (txt: string, maxW: number): string => {
      if (doc.getTextWidth(txt) <= maxW) return txt;
      let t = txt;
      while (t.length > 3 && doc.getTextWidth(`${t}…`) > maxW) t = t.slice(0, -1);
      return `${t}…`;
    };

    for (let i = 0; i < filas.length; i += cols) {
      if (y + cardH > H - 36) { doc.addPage(); y = 36; }
      for (let c = 0; c < cols; c++) {
        const f = filas[i + c];
        if (!f) break;
        const cx = M + c * (cardW + cardGap);
        const cy = y;
        const acento = COLOR_FLUJO[f.tipo_movimiento];

        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(...BORDE);
        doc.setLineWidth(0.6);
        doc.roundedRect(cx, cy, cardW, cardH, 4, 4, 'FD');
        doc.setFillColor(...acento);
        doc.rect(cx, cy + 1, 3.5, cardH - 2, 'F');

        // Insignia arriba a la derecha: % del total + tipo de flujo
        const txtPct = pdfSafe(f.pct_del_total != null ? `${f.pct_del_total.toFixed(1)}% · ${ETIQUETA_FLUJO[f.tipo_movimiento]}` : ETIQUETA_FLUJO[f.tipo_movimiento]);
        const txtSubBadge = pdfSafe(f.estado || f.origen_documento);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.8);
        const w1 = doc.getTextWidth(txtPct);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(5.5);
        const w2 = doc.getTextWidth(txtSubBadge);
        const badgeW = Math.min(cardW * 0.44, Math.max(90, Math.max(w1, w2) + 12));
        const badgeH = 15;
        const bx = cx + cardW - badgeW - 6;
        const by = cy + 4;
        const [ar, ag, ab] = acento;
        doc.setFillColor(Math.round(ar + (255 - ar) * 0.85), Math.round(ag + (255 - ag) * 0.85), Math.round(ab + (255 - ab) * 0.85));
        doc.roundedRect(bx, by, badgeW, badgeH, 3, 3, 'F');

        let fontPct = 6.8;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(fontPct);
        doc.setTextColor(...acento);
        while (doc.getTextWidth(txtPct) > badgeW - 6 && fontPct > 5.4) { fontPct -= 0.2; doc.setFontSize(fontPct); }
        doc.text(txtPct, bx + badgeW / 2, by + 5.8, { align: 'center' });

        let fontSub = 5.5;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(fontSub);
        doc.setTextColor(100, 116, 139);
        while (doc.getTextWidth(txtSubBadge) > badgeW - 6 && fontSub > 4.4) { fontSub -= 0.2; doc.setFontSize(fontSub); }
        doc.text(recortar(txtSubBadge, badgeW - 6), bx + badgeW / 2, by + 11.5, { align: 'center' });

        // Título: contraparte (o categoría)
        const maxTitleW = Math.max(60, (bx - 8) - (cx + 10));
        const tituloBase = (f.contraparte && f.contraparte !== '—') ? f.contraparte : (f.categoria || f.concepto || 'Sin clasificar');
        const titulo = pdfSafe(tituloBase);
        let titleFontSize = 9.5;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(titleFontSize);
        while (doc.getTextWidth(titulo) > maxTitleW && titleFontSize > 7.4) { titleFontSize -= 0.3; doc.setFontSize(titleFontSize); }
        doc.setTextColor(...TINTA);
        doc.text(recortar(titulo, maxTitleW), cx + 10, cy + 13);

        // Subtítulo: categoría · documento · caja · fecha
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.2);
        doc.setTextColor(100, 116, 139);
        const partes = [
          f.categoria && f.categoria !== tituloBase ? f.categoria : null,
          f.origen_documento && f.origen_documento !== f.categoria ? f.origen_documento : null,
          f.caja_origen && f.caja_origen !== '—' ? f.caja_origen : null,
          f.fecha ? fmtFechaReporte(f.fecha) : null,
        ].filter(Boolean);
        doc.text(recortar(pdfSafe(partes.join(' · ') || 'Tesorería'), cardW - 20), cx + 10, cy + 24);

        doc.setDrawColor(241, 245, 249);
        doc.setLineWidth(0.5);
        doc.line(cx + 8, cy + 29, cx + cardW - 8, cy + 29);

        // Métricas (respetan los interruptores de moneda)
        const metricas = obtenerMetricasFichaTesoreria(f, columnasClaves, { mostrarUsd: meta.mostrarUsd, mostrarBs: meta.mostrarBs });
        const innerW = cardW - 16;
        const colW = innerW / Math.max(1, metricas.length);
        const my = cy + 39;
        metricas.forEach((m, idx) => {
          const mx = cx + 8 + colW * idx;
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(6.2);
          doc.setTextColor(71, 85, 105);
          doc.text(pdfSafe(m.etiqueta), mx, my);
          doc.setFontSize(9.5);
          doc.setTextColor(...m.colorRgb);
          const valFit = doc.splitTextToSize(pdfSafe(m.valor), colW - 4) as string[];
          doc.text(valFit[0] ?? '', mx, my + 13);
          if (m.sub) {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(6.0);
            doc.setTextColor(148, 163, 184);
            const subFit = doc.splitTextToSize(pdfSafe(m.sub), colW - 4) as string[];
            doc.text(subFit[0] ?? '', mx, my + 23);
          }
        });
      }
      y += cardH + cardGap;
    }
  } else {
    const headCols = columnas.map((c) => pdfSafe(c.etiqueta));
    const bodyRows = filas.map((f) => columnas.map((c) => pdfSafe(textoCeldaTesoreria(f, c))));
    const totUsd = filas.reduce((a, f) => a + (f.monto_usd || 0), 0);
    const totBs = filas.reduce((a, f) => a + (f.monto_bs || 0), 0);
    const footRow = columnas.map((col, idx) => {
      if (col.clave === 'monto_usd') return fmtUsd(totUsd);
      if (col.clave === 'monto_bs') return fmtBs(totBs);
      return idx === 0 ? 'TOTALES' : '';
    });
    const columnStyles: Record<number, { halign: 'left' | 'right' | 'center' }> = {};
    columnas.forEach((col, idx) => { columnStyles[idx] = { halign: col.alineacion }; });
    const muchos = columnas.length >= 10;

    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M, bottom: 24 },
      head: [headCols],
      body: bodyRows,
      foot: [footRow],
      theme: 'grid',
      styles: {
        fontSize: muchos ? 6.5 : orient === 'landscape' ? 7.6 : 7.0,
        cellPadding: muchos ? 1.6 : 2.2,
        lineColor: BORDE, lineWidth: 0.3, textColor: TINTA, overflow: 'linebreak', valign: 'middle',
      },
      headStyles: { fillColor: NARANJA, textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
      footStyles: { fillColor: [241, 245, 249], textColor: [30, 41, 59], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: FONDO_ALT },
      columnStyles,
    });
  }

  // 4. Pies de página
  const numPaginas = doc.getNumberOfPages();
  for (let i = 1; i <= numPaginas; i++) {
    doc.setPage(i);
    doc.setDrawColor(...BORDE);
    doc.setLineWidth(0.4);
    doc.line(M, H - 18, W - M, H - 18);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(pdfSafe(`${idEmp.nombre} · RIF ${idEmp.rif} · Tesorería · ${TITULO_AMBITO_REPORTE[meta.ambito]}`), M, H - 9);
    doc.text(`Página ${i} de ${numPaginas}`, W - M, H - 9, { align: 'right' });
  }

  previewPdfDoc(doc, nombreArchivoTesoreria(meta.ambito, 'pdf'));
}

/* ============================================================
   3. CSV
   ============================================================ */

/** Escapa una celda de texto del CSV (separador ';') y la protege de fórmulas inyectadas. */
export function escaparCeldaCsv(val: unknown): string {
  let s = String(val ?? '');
  // Texto libre que empieza por = + - @ (o tab/retorno) Excel lo tomaría como fórmula:
  // se le antepone una comilla simple para que quede como TEXTO.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Arma el contenido del CSV (sin BOM): cabecera + una línea por fila, separador ';' y coma decimal. */
export function armarCsvTesoreria(
  filas: FilaReporteTesoreria[],
  columnasClaves: string[],
  meta: { mostrarUsd: boolean; mostrarBs: boolean },
): string {
  const columnas = columnasVisiblesTesoreria(columnasClaves, meta);
  const lineas: string[] = [columnas.map((c) => escaparCeldaCsv(c.etiqueta)).join(';')];
  for (const f of filas) {
    const vals = columnas.map((c) => {
      if (c.formato === 'moneda' || c.formato === 'moneda_bs' || c.formato === 'numero' || c.formato === 'porcentaje') {
        const n = numeroDeColumna(f, c.clave);
        return n == null ? '' : String(n).replace('.', ','); // coma decimal para Excel en español
      }
      const raw = rawDeColumna(f, c.clave);
      if (raw == null) return '';
      return escaparCeldaCsv(c.clave === 'fecha' ? fmtFechaReporte(String(raw)) : raw);
    });
    lineas.push(vals.join(';'));
  }
  return lineas.join('\r\n');
}

/** Descarga el CSV (lo dispara el botón «CSV»; nunca solo). */
export function descargarTesoreriaCsv(
  filas: FilaReporteTesoreria[],
  columnasClaves: string[],
  meta: MetadatosExportacionTesoreria,
): void {
  if (!columnasVisiblesTesoreria(columnasClaves, meta).length) throw new Error('Marca al menos una columna.');
  if (!filas.length) throw new Error('No hay datos para exportar.');
  const blob = new Blob(['﻿', armarCsvTesoreria(filas, columnasClaves, meta)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivoTesoreria(meta.ambito, 'csv');
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
