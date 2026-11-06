/* ============================================================
   Golden Touch · Tesorería · Exportación de Reportes (Excel / PDF / CSV)
   (02/11/2026)

   Exportación profesional moldeable del reporte financiero, calcada del de
   Combustible (exportarCombustible.ts) y adaptada a la multimoneda:
   - Excel (ExcelJS): hoja «Resumen» con KPIs (egresos/ingresos/neto) y Top
     categorías/proveedores; hoja principal con cabeceras naranjas, montos en
     USD y Bs formateados, totales y vista congelada.
   - PDF (jsPDF + autotable): membrete GT, barra naranja, tarjetas de KPIs,
     y dualidad Fichas Ejecutivas (borde por tipo de flujo) vs Tabla Tabular.
   - CSV: plano con BOM UTF-8 y delimitador ';' (Excel en Windows).

   Los montos en USD salen solo si el toggle maestro de USD está activo; los de
   Bs, solo si lo está el de Bs (igual que en la vista y en las fichas).
   ============================================================ */

import { previewExcelArchivo, previewPdf } from '@/shared/lib/reportePreview';
import { pdfSafe } from '@/shared/lib/pdfSafe';
import { identidadEmpresa } from '@/shared/lib/empresa';
import { loadLogoPdfEmpresa, dibujarLogoPdf, anchoLogoPdf } from '@/shared/lib/pdfLogo';
import { generarBloquesPreparacion, type PreparacionPorPagar } from './pendientesPorPagar';
import type {
  FilaReporteTesoreria,
  ResumenReporteTesoreria,
  CampoColumnaTesoreria,
  ModoAgrupacionTesoreria,
  AmbitoTesoreria,
  BaseTasaTesoreria,
  MonedaConsolidacion,
  TipoFlujoTesoreria,
} from './reporteTesoreriaMoldeable';
import {
  CAMPOS_REPORTE_TESORERIA,
  ETIQUETA_FLUJO,
  ETIQUETA_MODO_TESORERIA,
  esColumnaAplicableModoTesoreria,
  resolverCabeceraTarjetaTesoreria,
  obtenerMetricasFichaTesoreria,
} from './reporteTesoreriaMoldeable';

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

const fmtFecha = (f: string) => {
  const [y, m, d] = (f || '').split('-');
  return y && m && d ? `${d}/${m}/${y}` : f || '-';
};

const hoyStr = () => new Date().toISOString().slice(0, 10);

const TITULO_AMBITO: Record<AmbitoTesoreria, string> = {
  movimientos: 'Reporte de movimientos de Tesorería',
  por_pagar: 'Pendientes por pagar',
  creditos_cartera: 'Cuentas a crédito (cartera)',
};

export interface MetadatosExportacionTesoreria {
  desde: string;
  hasta: string;
  ambito: AmbitoTesoreria;
  agrupacion: ModoAgrupacionTesoreria;
  baseTasa: BaseTasaTesoreria;
  monedaConsolidacion: MonedaConsolidacion;
  mostrarUsd: boolean;
  mostrarBs: boolean;
  subtituloFiltros?: string;
  incluirResumen: boolean;
  orientacion?: 'auto' | 'portrait' | 'landscape';
  formatoPresentacion?: 'fichas' | 'tabla';
  ordenarPor?: 'usd' | 'bs' | 'fecha' | 'contraparte';
  /** KPIs en vista simple: dos tarjetas «Total $ / Total Bs» (bruto) en vez del detalle. */
  kpisSimplificados?: boolean;
  /** «Por preparar» (solo ámbito por_pagar): totales NATIVOS por método y moneda. Solo
   *  viene cuando el usuario deja encendido su toggle; si no, el reporte sale sin el bloque. */
  preparacion?: PreparacionPorPagar;
}


/** Total bruto por moneda: egresos + ingresos (positivo, sirve para los 3 ámbitos). */
function kpisSimples(resumen: ResumenReporteTesoreria, meta: MetadatosExportacionTesoreria): Array<{ label: string; val: string }> {
  const kpis: Array<{ label: string; val: string }> = [];
  if (meta.mostrarUsd) kpis.push({ label: 'TOTAL $', val: fmtUsd(resumen.totalEgresosUsd + resumen.totalIngresosUsd) });
  if (meta.mostrarBs) kpis.push({ label: 'TOTAL Bs', val: fmtBs(resumen.totalEgresosBs + resumen.totalIngresosBs) });
  return kpis;
}

/** Valor crudo de una columna (resuelve clave→campo de la fila). */
function rawDeColumna(f: FilaReporteTesoreria, clave: string): unknown {
  switch (clave) {
    case 'caja': return f.caja_origen;
    case 'tipo_mov': return ETIQUETA_FLUJO[f.tipo_movimiento];
    case 'operaciones': return f.total_operaciones ?? 1;
    case 'tasa_bcv': return f.tasa_bcv_aplicada;
    case 'pct_total': return f.pct_del_total;
    case 'saldo_caja': return f.saldo_caja_momento;
    default: return (f as unknown as Record<string, unknown>)[clave];
  }
}

/** El número subyacente de una columna numérica (para Excel), o null si no aplica. */
function numeroDeColumna(f: FilaReporteTesoreria, clave: string): number | null {
  switch (clave) {
    case 'operaciones': return f.total_operaciones ?? 1;
    case 'monto_usd': return f.monto_usd;
    case 'monto_bs': return f.monto_bs;
    case 'monto_original': return f.monto_original;
    case 'tasa_bcv': return f.tasa_bcv_aplicada;
    case 'pct_total': return f.pct_del_total ?? null;
    case 'saldo_caja': return f.saldo_caja_momento ?? null;
    default: return null;
  }
}

/** Texto formateado de una celda para PDF/CSV. */
function textoCelda(f: FilaReporteTesoreria, col: CampoColumnaTesoreria): string {
  const val = rawDeColumna(f, col.clave);
  if (val == null || val === '') return '-';
  switch (col.formato) {
    case 'moneda': return fmtUsd(Number(val));
    case 'moneda_bs': return fmtBs(Number(val));
    case 'numero': return fmtNum(Number(val), 2);
    case 'porcentaje': return fmtPct(Number(val));
    default:
      if (col.clave === 'fecha') return fmtFecha(String(val));
      return String(val);
  }
}

/** Columnas seleccionadas (en el orden del catálogo), respetando los toggles de moneda y la aplicabilidad a la dimensión. */
export function columnasVisibles(columnasClaves: string[], meta: { mostrarUsd: boolean; mostrarBs: boolean; agrupacion?: ModoAgrupacionTesoreria; ambito?: AmbitoTesoreria }): CampoColumnaTesoreria[] {
  return columnasClaves
    .map((c) => CAMPOS_REPORTE_TESORERIA.find((col) => col.clave === c))
    .filter((c): c is CampoColumnaTesoreria => {
      if (!c) return false;
      if (c.clave === 'monto_usd' && !meta.mostrarUsd) return false;
      if (c.clave === 'monto_bs' && !meta.mostrarBs) return false;
      if (meta.agrupacion && meta.agrupacion !== 'detallado' && !esColumnaAplicableModoTesoreria(c.clave, meta.agrupacion)) return false;
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
  const [{ default: ExcelJS }] = await Promise.all([import('exceljs')]);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Golden Touch 1127 C.A.';
  wb.created = new Date();

  const idEmp = identidadEmpresa('MGG');
  const columnas = columnasVisibles(columnasClaves, meta);

  // 0. Hoja «Por preparar» (solo por_pagar, si el usuario dejó su toggle encendido).
  if (meta.ambito === 'por_pagar' && meta.preparacion) {
    const prep = meta.preparacion;
    const tasaRefExcel = resumen.tasaBcvReferencia;
    const prepRes = generarBloquesPreparacion(prep, tasaRefExcel, {
      mostrarUsd: Boolean(meta.mostrarUsd),
      mostrarBs: Boolean(meta.mostrarBs),
    });

    if (prepRes.bloques.length > 0 || prepRes.sinMetodoTexto) {
      const wp = wb.addWorksheet('Por preparar', { views: [{ showGridLines: false }] });
      wp.columns = [{ width: 34 }, { width: 16 }, { width: 22 }, { width: 14 }];
      let r = 1;
      const tit = wp.getCell(r, 1);
      tit.value = prepRes.tituloSeccion;
      tit.font = { name: 'Arial', size: 13, bold: true, color: { argb: 'FFFF8A00' } };
      wp.mergeCells(r, 1, r, 4); r += 2;
      const head = wp.getRow(r);
      head.values = ['Concepto', 'Moneda / Ref.', 'Monto', 'Pagos / Op.'];
      head.font = { name: 'Arial', bold: true, color: { argb: 'FFFFFFFF' } };
      head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF8A00' } }; });
      r += 1;
      for (const b of prepRes.bloques) {
        const hr = wp.getRow(r);
        hr.values = [b.etiqueta, b.monedaCol, b.totalNum, b.nOrdenes];
        hr.font = { name: 'Arial', bold: true };
        hr.getCell(3).numFmt = b.numFmt;
        r += 1;
        for (const l of b.metodos) {
          const row = wp.getRow(r);
          row.values = [`   ${l.label}`, b.monedaCol, l.montoNum, l.nOrdenes];
          row.getCell(3).numFmt = b.numFmt;
          r += 1;
        }
      }
      if (prepRes.sinMetodoTexto) {
        r += 1;
        const sRow = wp.getRow(r);
        sRow.values = [prepRes.sinMetodoTexto];
        sRow.font = { name: 'Arial', italic: true, color: { argb: 'FF64748B' } };
      }
    }
  }

  // 1. Hoja Resumen
  if (meta.incluirResumen) {
    const ws = wb.addWorksheet('Resumen', { views: [{ showGridLines: true }] });
    ws.columns = [{ width: 5 }, { width: 28 }, { width: 22 }, { width: 22 }, { width: 22 }];

    ws.mergeCells('B2:E2');
    const r2 = ws.getCell('B2');
    r2.value = `${idEmp.nombre} · RESUMEN DE TESORERÍA`;
    r2.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFF8A00' } };

    ws.mergeCells('B3:E3');
    const r3 = ws.getCell('B3');
    r3.value = `${TITULO_AMBITO[meta.ambito]} | Período: ${fmtFecha(meta.desde)} al ${fmtFecha(meta.hasta)} | Emitido: ${new Date().toLocaleString('es-VE')}`;
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
      if (kpis.length < 4) {
        kpis.push({ label: 'SALDO NETO', val: meta.mostrarUsd ? fmtUsd(resumen.saldoNetoUsd) : fmtBs(resumen.saldoNetoBs) });
      }
    }

    kpis.slice(0, 4).forEach((k, i) => {
      const colLetter = String.fromCharCode(66 + i);
      const label = ws.getCell(`${colLetter}5`);
      label.value = k.label;
      label.font = { name: 'Arial', size: 8, bold: true, color: { argb: 'FF475569' } };
      label.alignment = { horizontal: 'center', vertical: 'middle' };
      label.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      const val = ws.getCell(`${colLetter}6`);
      val.value = k.val;
      val.font = { name: 'Arial', size: 13, bold: true, color: { argb: 'FFFF8A00' } };
      val.alignment = { horizontal: 'center', vertical: 'middle' };
      const bordeFino = { style: 'thin' as const, color: { argb: 'FFCBD5E1' } };
      ['5', '6'].forEach((rowNum) => {
        ws.getCell(`${colLetter}${rowNum}`).border = {
          left: bordeFino, right: bordeFino,
          top: rowNum === '5' ? bordeFino : undefined,
          bottom: rowNum === '6' ? bordeFino : undefined,
        };
      });
    });

    // Top categorías / proveedores (solo egresos)
    ws.getCell('B8').value = 'TOP CATEGORÍAS (EGRESOS)';
    ws.getCell('B8').font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF1E293B' } };
    const headTop = ws.getRow(9);
    headTop.getCell(2).value = '#';
    headTop.getCell(3).value = 'Categoría';
    headTop.getCell(4).value = 'Monto ($)';
    headTop.getCell(5).value = '% del Total';
    for (let c = 2; c <= 5; c++) {
      headTop.getCell(c).font = { name: 'Arial', size: 8.5, bold: true, color: { argb: 'FFFFFFFF' } };
      headTop.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF8A00' } };
      headTop.getCell(c).alignment = { horizontal: c === 3 ? 'left' : 'center' };
    }
    resumen.topCategorias.forEach((tc, idx) => {
      const r = ws.getRow(10 + idx);
      r.getCell(2).value = idx + 1;
      r.getCell(3).value = tc.nombre;
      r.getCell(4).value = tc.montoUsd;
      r.getCell(4).numFmt = '"$"#,##0.00';
      r.getCell(5).value = tc.porcentaje / 100;
      r.getCell(5).numFmt = '0.0%';
      for (let c = 2; c <= 5; c++) {
        r.getCell(c).font = { name: 'Arial', size: 8.5, color: { argb: 'FF334155' } };
        r.getCell(c).border = { bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
      }
    });

    const baseProv = 10 + resumen.topCategorias.length + 1;
    ws.getCell(`B${baseProv}`).value = 'TOP PROVEEDORES / BENEFICIARIOS (EGRESOS)';
    ws.getCell(`B${baseProv}`).font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF1E293B' } };
    resumen.topProveedores.forEach((tp, idx) => {
      const r = ws.getRow(baseProv + 1 + idx);
      r.getCell(2).value = idx + 1;
      r.getCell(3).value = tp.nombre;
      r.getCell(4).value = tp.montoUsd;
      r.getCell(4).numFmt = '"$"#,##0.00';
      r.getCell(5).value = tp.porcentaje / 100;
      r.getCell(5).numFmt = '0.0%';
      for (let c = 2; c <= 5; c++) r.getCell(c).font = { name: 'Arial', size: 8.5, color: { argb: 'FF334155' } };
    });
  }

  // 2. Hoja de datos
  const orient = meta.orientacion === 'portrait' ? 'portrait' : meta.orientacion === 'landscape' ? 'landscape' : columnas.length > 7 ? 'landscape' : 'portrait';
  const ws = wb.addWorksheet('Tesorería', {
    pageSetup: { orientation: orient, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ state: 'frozen', ySplit: 5 }],
  });
  ws.columns = [{ width: 4 }, ...columnas.map((c) => ({ width: Math.max(c.anchoExcel, c.etiqueta.length + 4) }))];

  ws.mergeCells(2, 2, 2, columnas.length + 1);
  const tit = ws.getCell(2, 2);
  tit.value = `${idEmp.nombre} · ${TITULO_AMBITO[meta.ambito].toUpperCase()}`;
  tit.font = { name: 'Arial', size: 13, bold: true, color: { argb: 'FFFF8A00' } };

  ws.mergeCells(3, 2, 3, columnas.length + 1);
  const sub = ws.getCell(3, 2);
  sub.value = `Período: ${fmtFecha(meta.desde)} al ${fmtFecha(meta.hasta)} | Agrupación: ${ETIQUETA_MODO_TESORERIA[meta.agrupacion] || meta.agrupacion}${meta.subtituloFiltros ? ` | ${meta.subtituloFiltros}` : ''} | Tasa BCV: ${fmtNum(resumen.tasaBcvReferencia, 2)} ($/Bs) ${meta.baseTasa === 'historica' ? '(histórica)' : '(del día)'}`;
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
        cell.value = col.clave === 'fecha' ? fmtFecha(String(raw ?? '')) : (raw != null && raw !== '' ? String(raw) : '-');
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
    if (cIdx === 0) {
      cell.value = 'TOTALES';
    } else if (col.clave === 'monto_usd') {
      cell.value = totUsd; cell.numFmt = '"$"#,##0.00';
    } else if (col.clave === 'monto_bs') {
      cell.value = totBs; cell.numFmt = '"Bs "#,##0.00';
    }
  });

  const bytes = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  await previewExcelArchivo(bytes, `tesoreria-${meta.ambito}-${hoyStr()}.xlsx`);
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
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const columnas = columnasVisibles(columnasClaves, meta);
  if (!columnas.length) throw new Error('Selecciona al menos una columna.');
  if (!filas.length) throw new Error('No hay datos de tesorería para el período seleccionado.');
  const colsClavesValidas = columnas.map((c) => c.clave);

  const esFichas = meta.formatoPresentacion !== 'tabla';
  const orient = meta.orientacion === 'portrait'
    ? 'portrait'
    : meta.orientacion === 'landscape'
      ? 'landscape'
      : esFichas || columnas.length > 6
        ? 'landscape'
        : 'portrait';

  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: orient });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 36;
  const UW = W - M * 2;
  let y = M;

  const idEmp = identidadEmpresa('MGG');
  const logo = await loadLogoPdfEmpresa('MGG').catch(() => null);

  // 1. Membrete
  const cajaLogo = 40;
  if (logo) dibujarLogoPdf(doc, logo, M, y, cajaLogo);
  const tx = logo ? M + anchoLogoPdf(cajaLogo) + 12 : M;
  const anchoTexto = W - M - tx;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(...NARANJA);
  const titLineas = doc.splitTextToSize(TITULO_AMBITO[meta.ambito], anchoTexto) as string[];
  doc.text(titLineas, tx, y + 14);

  let yy = y + 14 + (titLineas.length - 1) * 14;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(80, 80, 80);
  const subLineas = doc.splitTextToSize(
    `${idEmp.nombre} · RIF ${idEmp.rif} · Período: ${fmtFecha(meta.desde)} al ${fmtFecha(meta.hasta)} · Agrupado por: ${ETIQUETA_MODO_TESORERIA[meta.agrupacion] || meta.agrupacion} · Tasa BCV: ${fmtNum(resumen.tasaBcvReferencia, 2)} $/Bs · ${filas.length} registros`,
    anchoTexto,
  ) as string[];
  doc.text(subLineas, tx, yy + 12);
  yy += 12 + (subLineas.length - 1) * 10;

  y = Math.max(y + cajaLogo + 6, yy + 14);
  doc.setDrawColor(...NARANJA);
  doc.setLineWidth(1.4);
  doc.line(M, y, W - M, y);
  y += 12;

  // 1b. «Por preparar» (solo por_pagar, si el usuario dejó su toggle encendido).
  // Totales por moneda/método respetando la elección de moneda (Bs, Dólar o Ambos).
  if (meta.ambito === 'por_pagar' && meta.preparacion) {
    const prep = meta.preparacion;
    const tasaRefPdf = resumen.tasaBcvReferencia;
    const prepRes = generarBloquesPreparacion(prep, tasaRefPdf, {
      mostrarUsd: Boolean(meta.mostrarUsd),
      mostrarBs: Boolean(meta.mostrarBs),
    });

    if (prepRes.bloques.length > 0 || prepRes.sinMetodoTexto) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(...NARANJA);
      doc.text(pdfSafe(prepRes.tituloSeccion), M, y + 2);
      y += 16;
      const VERDE: [number, number, number] = [34, 197, 94];

      for (const b of prepRes.bloques) {
        const boxH = 26 + b.metodos.length * 12;
        if (y + boxH > H - 36) { doc.addPage(); y = 36; }
        const acento: [number, number, number] = b.esDivisa ? VERDE : NARANJA;
        // Tarjeta por moneda: barra de acento, moneda a la izquierda, total alineado a la derecha.
        doc.setFillColor(250, 250, 250);
        doc.setDrawColor(...BORDE);
        doc.setLineWidth(0.6);
        doc.roundedRect(M, y, UW, boxH, 4, 4, 'FD');
        doc.setFillColor(...acento);
        doc.rect(M, y + 1, 3.5, boxH - 2, 'F');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10.5);
        doc.setTextColor(...acento);
        doc.text(pdfSafe(b.etiqueta), M + 10, y + 14);

        doc.setFontSize(11);
        doc.setTextColor(...TINTA);
        doc.text(pdfSafe(b.totalTexto), W - M - 8, y + 14, { align: 'right' });
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(130, 130, 130);
        doc.text(pdfSafe(`${b.nOrdenes} pago(s)`), M + 10, y + 22);
        let yy = y + 22;
        for (const l of b.metodos) {
          yy += 12;
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8.5);
          doc.setTextColor(70, 70, 70);
          doc.text(pdfSafe(`•  ${l.label}`), M + 16, yy);

          doc.setFont('helvetica', 'bold');
          doc.text(pdfSafe(`${l.montoTexto}  ·  ${l.nOrdenes} op.`), W - M - 8, yy, { align: 'right' });
        }
        y += boxH + 6;
      }
      if (prepRes.sinMetodoTexto) {
        if (y > H - 50) { doc.addPage(); y = 36; }
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(8);
        doc.setTextColor(120, 120, 120);
        doc.text(pdfSafe(prepRes.sinMetodoTexto), M, y + 4);
        y += 12;
      }
      y += 2;
      doc.setDrawColor(...BORDE);
      doc.setLineWidth(0.5);
      doc.line(M, y, W - M, y);
      y += 12;
    }
  }

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
          val: resumen.tasaBcvReferencia > 0 ? `Bs ${fmtNum(resumen.tasaBcvReferencia, 2)}/$` : '—',
          sub: `${resumen.totalOperaciones} operaciones`,
        });
      }
    }

    const cards = kpis.slice(0, 4);
    if (cards.length === 1) {
      const k = cards[0];
      const boxH = 46;
      if (y + boxH > H - 36) { doc.addPage(); y = 36; }

      // Hero banner destacado cuando el Total está solo: máximo protagonismo al monto
      doc.setFillColor(252, 253, 255);
      doc.setDrawColor(...BORDE);
      doc.setLineWidth(0.8);
      doc.roundedRect(M, y, UW, boxH, 4, 4, 'FD');

      const esBs = k.label.includes('Bs');
      const acentoTotal: [number, number, number] = esBs ? NARANJA : [22, 163, 74];
      doc.setFillColor(...acentoTotal);
      doc.rect(M, y + 1, 4.5, boxH - 2, 'F');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.0);
      doc.setTextColor(71, 85, 105);
      const rotuloTotal = esBs ? 'TOTAL CONSOLIDADO (BOLÍVARES - Bs)' : 'TOTAL CONSOLIDADO (DÓLARES - $ USD)';
      doc.text(pdfSafe(rotuloTotal), M + 14, y + 13);

      // MONTO GRANDE Y PROTAGÓNICO (22pt)
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(22);
      doc.setTextColor(...acentoTotal);
      doc.text(pdfSafe(k.val), M + 14, y + 33);

      if (k.sub) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(100, 116, 139);
        doc.text(pdfSafe(k.sub), M + 14, y + 41);
      }

      // Pastilla ejecutiva a la derecha
      const chipW = 145;
      const chipH = 26;
      const chipX = W - M - chipW - 8;
      const chipY = y + (boxH - chipH) / 2;
      doc.setFillColor(241, 245, 249);
      doc.setDrawColor(...BORDE);
      doc.setLineWidth(0.5);
      doc.roundedRect(chipX, chipY, chipW, chipH, 3, 3, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.8);
      doc.setTextColor(30, 41, 59);
      doc.text(pdfSafe(`${resumen.totalOperaciones} operaciones · ${filas.length} ${filas.length === 1 ? 'grupo' : 'grupos'}`), chipX + chipW / 2, chipY + 11, { align: 'center' });

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.8);
      doc.setTextColor(100, 116, 139);
      const txtTasa = resumen.tasaBcvReferencia > 0 ? `Tasa BCV ref: Bs ${fmtNum(resumen.tasaBcvReferencia, 2)}/$` : 'Valuación oficial';
      doc.text(pdfSafe(txtTasa), chipX + chipW / 2, chipY + 20, { align: 'center' });

      y += boxH + 12;
    } else if (cards.length === 2) {
      const cardGap = 10;
      const cardW = (UW - cardGap) / 2;
      const cardH = 42;
      if (y + cardH > H - 36) { doc.addPage(); y = 36; }
      cards.forEach((k, i) => {
        const cx = M + i * (cardW + cardGap);
        const esBs = k.label.includes('Bs');
        const acentoTotal: [number, number, number] = esBs ? NARANJA : [22, 163, 74];

        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(...BORDE);
        doc.setLineWidth(0.7);
        doc.roundedRect(cx, y, cardW, cardH, 4, 4, 'FD');
        doc.setFillColor(...acentoTotal);
        doc.rect(cx, y + 1, 3.5, cardH - 2, 'F');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(71, 85, 105);
        doc.text(pdfSafe(k.label), cx + 10, y + 12);

        doc.setFontSize(17);
        doc.setTextColor(...acentoTotal);
        doc.text(pdfSafe(k.val), cx + 10, y + 29);

        if (k.sub) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7);
          doc.setTextColor(148, 163, 184);
          doc.text(pdfSafe(k.sub), cx + 10, y + 37);
        }
      });
      y += cardH + 12;
    } else if (cards.length > 0) {
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

  // 3. Fichas vs Tabla
  if (esFichas) {
    const cols = orient === 'landscape' ? 2 : 1;
    const cardGap = 10;
    const cardW = (UW - (cols - 1) * cardGap) / cols;
    const innerW = cardW - 16;

    // Separar las métricas de la cuadrícula estándar del método de pago, el cual
    // posee datos bancarios largos (banco, titular, RIF, número de cuenta o pago móvil)
    // que deben ocupar todo el ancho de la tarjeta para jamás cortarse.
    const hayMetPago = colsClavesValidas.includes('metodo_pago');
    const maxMetricasGrid = Math.max(
      ...filas.map((f) => obtenerMetricasFichaTesoreria(f, colsClavesValidas, { mostrarUsd: meta.mostrarUsd, mostrarBs: meta.mostrarBs }).filter((m) => m.clave !== 'metodo_pago').length),
      hayMetPago ? 0 : 1,
    );

    const colsPorFila = orient === 'landscape'
      ? (maxMetricasGrid <= 3 ? Math.max(1, maxMetricasGrid) : maxMetricasGrid === 4 ? 4 : 3)
      : (maxMetricasGrid <= 4 ? Math.max(1, maxMetricasGrid) : 4);
    const numFilasGrid = Math.ceil(maxMetricasGrid / colsPorFila);
    const haySubAlguna = filas.some((f) => Boolean(resolverCabeceraTarjetaTesoreria(f, meta.agrupacion, fmtFecha, colsClavesValidas).subtitulo?.trim()));
    const altoHeader = haySubAlguna ? 34 : 28;
    const altoFilaMetrica = 25;
    const altoGrid = numFilasGrid > 0 ? numFilasGrid * altoFilaMetrica : 0;
    const altoPagoBloque = hayMetPago ? 26 : 0;
    const cardH = altoHeader + altoGrid + (numFilasGrid > 0 && hayMetPago ? 4 : 0) + altoPagoBloque + 8;

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

        // Badge superior derecho: % del total + tipo de flujo (SOLO si están marcados en colsClavesValidas)
        const tienePct = colsClavesValidas.includes('pct_total') && f.pct_del_total != null;
        const tieneTipo = colsClavesValidas.includes('tipo_mov');
        const partesBadge: string[] = [];
        if (tienePct) partesBadge.push(`${f.pct_del_total!.toFixed(1)}%`);
        if (tieneTipo) partesBadge.push(ETIQUETA_FLUJO[f.tipo_movimiento]);
        const txtPct = partesBadge.join(' · ');
        const mostrarBadge = Boolean(txtPct);

        let badgeW = 0;
        let bx = cx + cardW - 6;
        let by = cy + 4;
        if (mostrarBadge) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(6.8);
          const w1 = doc.getTextWidth(txtPct);
          badgeW = Math.min(cardW * 0.44, Math.max(50, w1 + 12));
          const badgeH = 14;
          bx = cx + cardW - badgeW - 6;
          by = cy + 4;

          const [ar, ag, ab] = acento;
          doc.setFillColor(Math.min(255, ar + 180), Math.min(255, ag + 70), Math.min(255, ab + 60));
          doc.roundedRect(bx, by, badgeW, badgeH, 3, 3, 'F');

          let fontPct = 6.8;
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(fontPct);
          doc.setTextColor(...acento);
          while (doc.getTextWidth(txtPct) > badgeW - 6 && fontPct > 5.2) { fontPct -= 0.2; doc.setFontSize(fontPct); }
          doc.text(txtPct, bx + badgeW / 2, by + 9.5, { align: 'center' });
        }

        // Cabecera ejecutiva con rótulo explícito de la dimensión seleccionada:
        // Respeta rigurosamente las columnas válidas marcadas (colsClavesValidas)
        const cab = resolverCabeceraTarjetaTesoreria(f, meta.agrupacion, fmtFecha, colsClavesValidas);

        // 1. Rótulo superior en mayúsculas pequeñas (ej: CATEGORÍA, CAJA / BANCO, TIPO DE FLUJO, etc.)
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.2);
        doc.setTextColor(...acento);
        doc.text(pdfSafe(cab.rotulo.toUpperCase()), cx + 10, cy + 9);

        // 2. Título principal (el valor específico de la dimensión seleccionada)
        const maxTitleW = mostrarBadge ? Math.max(60, (bx - 8) - (cx + 10)) : (cardW - 20);
        const titulo = pdfSafe(cab.titulo);
        let titleFontSize = 9.8;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(titleFontSize);
        while (doc.getTextWidth(titulo) > maxTitleW && titleFontSize > 7.4) {
          titleFontSize -= 0.3;
          doc.setFontSize(titleFontSize);
        }
        let titleFinal = titulo;
        if (doc.getTextWidth(titleFinal) > maxTitleW) {
          while (titleFinal.length > 3 && doc.getTextWidth(titleFinal + '…') > maxTitleW) {
            titleFinal = titleFinal.slice(0, -1);
          }
          titleFinal += '…';
        }
        doc.setTextColor(...TINTA);
        doc.text(titleFinal, cx + 10, cy + 17);

        // 3. Subtítulo: metadatos secundarios (solo si existen y fueron seleccionados)
        const haySub = Boolean(cab.subtitulo && cab.subtitulo.trim());
        if (haySub) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(6.8);
          doc.setTextColor(100, 116, 139);
          const metaTxt = pdfSafe(cab.subtitulo);
          const maxMetaW = cardW - 20;
          let metaFinal = metaTxt;
          if (doc.getTextWidth(metaFinal) > maxMetaW) {
            while (metaFinal.length > 3 && doc.getTextWidth(metaFinal + '…') > maxMetaW) {
              metaFinal = metaFinal.slice(0, -1);
            }
            metaFinal += '…';
          }
          doc.text(metaFinal, cx + 10, cy + 24);
        }

        const sepY = haySub ? cy + 29 : cy + 23;
        doc.setDrawColor(241, 245, 249);
        doc.setLineWidth(0.5);
        doc.line(cx + 8, sepY, cx + cardW - 8, sepY);

        // Métricas dinámicas: separamos las métricas regulares de la de método de pago
        const metricas = obtenerMetricasFichaTesoreria(f, colsClavesValidas, { mostrarUsd: meta.mostrarUsd, mostrarBs: meta.mostrarBs });
        const metPago = metricas.find((m) => m.clave === 'metodo_pago');
        const metricasGrid = metricas.filter((m) => m.clave !== 'metodo_pago');

        const myBase = sepY + 9;
        const colW = innerW / colsPorFila;
        const maxTextW = colW - 6;

        metricasGrid.forEach((m, idx) => {
          const filaIdx = Math.floor(idx / colsPorFila);
          const colEnFila = idx % colsPorFila;
          const mx = cx + 8 + colW * colEnFila;
          const my = myBase + filaIdx * altoFilaMetrica;

          // Etiqueta
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(5.8);
          doc.setTextColor(71, 85, 105);
          let lblTxt = pdfSafe(m.etiqueta);
          if (doc.getTextWidth(lblTxt) > maxTextW) {
            while (lblTxt.length > 3 && doc.getTextWidth(lblTxt + '…') > maxTextW) {
              lblTxt = lblTxt.slice(0, -1);
            }
            lblTxt += '…';
          }
          doc.text(lblTxt, mx, my);

          // Valor
          doc.setFont('helvetica', 'bold');
          let valSize = 8.2;
          doc.setFontSize(valSize);
          doc.setTextColor(...m.colorRgb);
          let valTxt = pdfSafe(m.valor);
          while (doc.getTextWidth(valTxt) > maxTextW && valSize > 6.0) {
            valSize -= 0.3;
            doc.setFontSize(valSize);
          }
          if (doc.getTextWidth(valTxt) > maxTextW) {
            while (valTxt.length > 3 && doc.getTextWidth(valTxt + '…') > maxTextW) {
              valTxt = valTxt.slice(0, -1);
            }
            valTxt += '…';
          }
          doc.text(valTxt, mx, my + 8.5);

          // Subtítulo
          if (m.sub) {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(5.4);
            doc.setTextColor(148, 163, 184);
            let subTxt = pdfSafe(m.sub);
            if (doc.getTextWidth(subTxt) > maxTextW) {
              while (subTxt.length > 3 && doc.getTextWidth(subTxt + '…') > maxTextW) {
                subTxt = subTxt.slice(0, -1);
              }
              subTxt += '…';
            }
            doc.text(subTxt, mx, my + 14.5);
          }
        });

        // Bloque de Método y Datos de Pago a ANCHO COMPLETO:
        // Asegura que el beneficiario, RIF, número de cuenta y banco no se corten.
        if (metPago) {
          const py = myBase + (numFilasGrid > 0 ? numFilasGrid * altoFilaMetrica + 2 : 0);
          const pW = innerW;
          const pH = 24;

          doc.setFillColor(248, 250, 252);
          doc.setDrawColor(226, 232, 240);
          doc.setLineWidth(0.5);
          doc.roundedRect(cx + 8, py, pW, pH, 3, 3, 'FD');
          doc.setFillColor(16, 185, 129);
          doc.rect(cx + 8, py + 1, 2.5, pH - 2, 'F');

          doc.setFont('helvetica', 'bold');
          doc.setFontSize(5.8);
          doc.setTextColor(71, 85, 105);
          doc.text('MÉTODO Y DATOS DE PAGO:', cx + 14, py + 7.5);

          doc.setFontSize(7.6);
          doc.setTextColor(16, 185, 129);
          const offsetMetodo = doc.getTextWidth('MÉTODO Y DATOS DE PAGO: ') + 3;
          doc.text(pdfSafe(metPago.valor), cx + 14 + offsetMetodo, py + 7.5);

          if (metPago.sub) {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(6.4);
            doc.setTextColor(51, 65, 85);
            const maxSubW = pW - 14;
            const subLineas = doc.splitTextToSize(pdfSafe(metPago.sub), maxSubW) as string[];
            doc.text(subLineas[0] ?? '', cx + 14, py + 15.5);
            if (subLineas[1]) {
              doc.text(subLineas[1], cx + 14, py + 21.5);
            }
          }
        }
      }
      y += cardH + cardGap;
    }
  } else {
    if (meta.agrupacion !== 'detallado') {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(...TINTA);
      doc.text(
        pdfSafe(`Resumen consolidado agrupado por ${ETIQUETA_MODO_TESORERIA[meta.agrupacion]} (${filas.length} grupos · ${resumen.totalOperaciones} operaciones)`),
        M,
        y - 4,
      );
      y += 6;
    }

    const headCols = columnas.map((c) => pdfSafe(c.etiqueta));
    const bodyRows = filas.map((f) => columnas.map((c) => pdfSafe(textoCelda(f, c))));

    const totUsd = filas.reduce((a, f) => a + (f.monto_usd || 0), 0);
    const totBs = filas.reduce((a, f) => a + (f.monto_bs || 0), 0);
    const footRow = columnas.map((col, idx) => {
      if (idx === 0) return 'TOTALES';
      if (col.clave === 'operaciones') return `${resumen.totalOperaciones} ops`;
      if (col.clave === 'monto_usd') return fmtUsd(totUsd);
      if (col.clave === 'monto_bs') return fmtBs(totBs);
      if (col.clave === 'pct_total') return '100.0 %';
      return '';
    });

    const columnStyles: Record<number, { halign: 'left' | 'right' | 'center' }> = {};
    columnas.forEach((col, idx) => { columnStyles[idx] = { halign: col.alineacion }; });
    const esMuchosCampos = columnas.length >= 10;

    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M, bottom: 24 },
      head: [headCols],
      body: bodyRows,
      foot: [footRow],
      theme: 'grid',
      styles: {
        fontSize: esMuchosCampos ? 6.5 : orient === 'landscape' ? 7.6 : 7.0,
        cellPadding: esMuchosCampos ? 1.6 : 2.2,
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
    doc.text(`${idEmp.nombre} · RIF ${idEmp.rif} · Tesorería (${meta.ambito})`, M, H - 9);
    doc.text(`Página ${i} de ${numPaginas}`, W - M, H - 9, { align: 'right' });
  }

  previewPdf(doc, `tesoreria-${meta.ambito}-${hoyStr()}.pdf`);
}

/* ============================================================
   3. CSV
   ============================================================ */

export function descargarTesoreriaCsv(
  filas: FilaReporteTesoreria[],
  columnasClaves: string[],
  meta: MetadatosExportacionTesoreria,
): void {
  const columnas = columnasVisibles(columnasClaves, meta);
  if (!columnas.length) throw new Error('Selecciona al menos una columna.');
  if (!filas.length) throw new Error('No hay datos para exportar.');

  const escapar = (val: unknown) => {
    let s = String(val ?? '');
    // Anti «CSV formula injection»: si el texto empieza por un carácter que
    // Excel/Sheets interpretarían como fórmula (= + - @ o tab/retorno), se le
    // antepone una comilla simple para que quede como TEXTO. La contraparte, el
    // concepto, el estado, etc. son texto libre que pudo escribir cualquiera.
    // Las columnas numéricas se formatean aparte y no pasan por aquí.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return (s.includes(';') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lineas: string[] = [];
  lineas.push(columnas.map((c) => escapar(c.etiqueta)).join(';'));
  for (const f of filas) {
    const vals = columnas.map((c) => {
      if (c.formato === 'moneda' || c.formato === 'moneda_bs' || c.formato === 'numero' || c.formato === 'porcentaje') {
        const n = numeroDeColumna(f, c.clave);
        return n == null ? '' : String(n).replace('.', ','); // coma decimal para Excel en español
      }
      const raw = rawDeColumna(f, c.clave);
      if (raw == null) return '';
      return escapar(c.clave === 'fecha' ? fmtFecha(String(raw)) : raw);
    });
    lineas.push(vals.join(';'));
  }

  const csvContent = '﻿' + lineas.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tesoreria-${meta.ambito}-${hoyStr()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}


export const columnasVisiblesTesoreria = columnasVisibles;
