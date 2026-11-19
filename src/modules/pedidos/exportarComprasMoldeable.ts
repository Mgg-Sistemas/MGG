/* ============================================================
   Golden Touch · Compras · Exportación del Reporte Moldeable (Excel / PDF / CSV)
   (10/11/2026)

   Calcado de `exportarInventarioMoldeable.ts`, adaptado a compras con doble
   moneda ($ y Bs) y a la analítica del resumen (totales, por estado, rankings
   por departamento, bloque de compras directas por categoría de gasto, ranking
   de cotizaciones y tops). Separa las funciones PURAS `construir*` (devuelven
   bytes/doc/string, testeables) de los envoltorios `descargar*` (preview/DOM).

   Formatos (decisión de la líder):
   - resumen   → solo la página de resumen + analítica.
   - detallado → el listado + encabezado de totales (KPIs), sin analítica completa.
   - hibrido   → resumen + analítica completos, y a continuación el listado.
   ============================================================ */

import { previewExcelArchivo, previewPdf } from '@/shared/lib/reportePreview';
import { pdfSafe } from '@/shared/lib/pdfSafe';
import { identidadEmpresa, EMPRESA_NOMBRE, EMPRESA_RIF } from '@/shared/lib/empresa';
import { loadLogoPdfEmpresa, dibujarLogoPdf, anchoLogoPdf } from '@/shared/lib/pdfLogo';
import type { jsPDF } from 'jspdf';
import {
  CAMPOS_REPORTE_COMPRAS,
  ETIQUETA_TIPO_COMPRA,
  type AmbitoCompras,
  type CampoColumnaCompras,
  type FilaReporteCompras,
  type ModoAgrupacionCompras,
  type ResumenReporteCompras,
} from './comprasMoldeable';

const NARANJA: [number, number, number] = [255, 138, 0];

const AVISO_RANKING = 'No incluye las compras directas, que se agrupan por categoría de gasto.';

const fmtNum = (v: number | null | undefined, dec = 2) =>
  v == null ? '-' : Number(v).toLocaleString('es-VE', { minimumFractionDigits: 0, maximumFractionDigits: dec });
const fmtUsd = (v: number | null | undefined) =>
  v == null ? '-' : `$ ${Number(v).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtBs = (v: number | null | undefined) =>
  v == null ? '-' : `Bs ${Number(v).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPct = (v: number | null | undefined) => (v == null ? '-' : `${Number(v).toFixed(1)} %`);
const fmtFecha = (f: string) => {
  const [y, m, d] = (f || '').split('-');
  return y && m && d ? `${d}/${m}/${y}` : f || '-';
};
const hoyStr = () => new Date().toISOString().slice(0, 10);

const TITULO = 'Reporte de Compras';

export interface MetadatosExportacionCompras {
  desde: string;
  hasta: string;
  ambito: AmbitoCompras;
  agrupacion: ModoAgrupacionCompras;
  formato: 'resumen' | 'detallado' | 'hibrido';
  subtituloFiltros?: string;
  mostrarUsd: boolean;
  mostrarBs: boolean;
  tasaBcv: number;
  orientacion?: 'auto' | 'portrait' | 'landscape';
  formatoPresentacion?: 'fichas' | 'tabla';
  incluirCreditos?: boolean;
}

const incluyeResumen = (m: MetadatosExportacionCompras) => m.formato === 'resumen' || m.formato === 'hibrido';
const incluyeDetalle = (m: MetadatosExportacionCompras) => m.formato === 'detallado' || m.formato === 'hibrido';

/** Valor crudo de una columna (clave→campo de la fila). */
function rawDeColumna(f: FilaReporteCompras, clave: string): unknown {
  switch (clave) {
    case 'tipo_compra': return ETIQUETA_TIPO_COMPRA[f.tipo_compra];
    case 'pct_total': return f.pct_del_total;
    default: return (f as unknown as Record<string, unknown>)[clave];
  }
}

/** El número subyacente de una columna numérica (para Excel/CSV), o null. */
function numeroDeColumna(f: FilaReporteCompras, clave: string): number | null {
  switch (clave) {
    case 'cantidad': return f.cantidad;
    case 'monto_usd': return f.monto_usd;
    case 'monto_bs': return f.monto_bs;
    case 'pagado_usd': return f.pagado_usd;
    case 'pct_total': return f.pct_del_total ?? null;
    default: return null;
  }
}

/** Texto formateado de una celda para PDF. */
export function textoCelda(f: FilaReporteCompras, col: CampoColumnaCompras): string {
  const val = rawDeColumna(f, col.clave);
  if (val == null || val === '') return '-';
  switch (col.formato) {
    case 'moneda': return col.clave === 'monto_bs' ? fmtBs(Number(val)) : fmtUsd(Number(val));
    case 'numero': return fmtNum(Number(val), 2);
    case 'porcentaje': return fmtPct(Number(val));
    default:
      if (col.clave === 'fecha') return fmtFecha(String(val));
      return String(val);
  }
}

/** Columnas seleccionadas (en el orden del catálogo), filtradas por ámbito y por los interruptores $/Bs. */
function columnasVisibles(columnasClaves: string[], meta: MetadatosExportacionCompras): CampoColumnaCompras[] {
  return columnasClaves
    .map((c) => CAMPOS_REPORTE_COMPRAS.find((col) => col.clave === c))
    .filter((c): c is CampoColumnaCompras => {
      if (!c) return false;
      if (c.ambito && c.ambito !== 'ambos' && c.ambito !== meta.ambito) return false;
      if (!meta.mostrarUsd && (c.clave === 'monto_usd' || c.clave === 'pagado_usd')) return false;
      if (!meta.mostrarBs && c.clave === 'monto_bs') return false;
      return true;
    });
}

/** KPIs del encabezado de totales (siempre presentes). */
function kpisDeResumen(r: ResumenReporteCompras, meta: MetadatosExportacionCompras): Array<{ label: string; val: string; sub?: string }> {
  const dinero = (usd: number, bs: number) =>
    meta.mostrarUsd && meta.mostrarBs ? `${fmtUsd(usd)} · ${fmtBs(bs)}` : meta.mostrarUsd ? fmtUsd(usd) : fmtBs(bs);
  return [
    { label: 'TOTAL DE COMPRAS', val: `${r.totalCompras}`, sub: dinero(r.totalUsd, r.totalBs) },
    { label: 'FINALIZADAS', val: `${r.finalizadasCount}`, sub: dinero(r.finalizadasUsd, r.finalizadasBs) },
    { label: 'PENDIENTES', val: `${r.pendientesCount}`, sub: dinero(r.pendientesUsd, r.pendientesBs) },
    { label: 'PAGADO', val: dinero(r.pagadoUsd, r.pagadoBs), sub: r.deptoQueMasGasto ? `Más gastó: ${r.deptoQueMasGasto}` : 'del rango' },
  ];
}

/* ============================================================
   1. EXCEL (ExcelJS)
   ============================================================ */

function argb(rgb: [number, number, number]): string {
  return 'FF' + rgb.map((n) => n.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export async function construirComprasExcel(
  filas: FilaReporteCompras[],
  resumen: ResumenReporteCompras,
  columnasClaves: string[],
  meta: MetadatosExportacionCompras,
): Promise<ArrayBuffer> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Mineral Group Guayana C.A.';
  wb.created = new Date();
  const idEmp = identidadEmpresa();
  const columnas = columnasVisibles(columnasClaves, meta);
  const NAR = argb(NARANJA);

  // 1. Hoja Resumen (se omite si el ámbito es exclusivamente cuentas a crédito)
  if (incluyeResumen(meta) && meta.ambito !== 'creditos') {
    const ws = wb.addWorksheet('Resumen', { views: [{ showGridLines: true }] });
    ws.columns = [{ width: 5 }, { width: 30 }, { width: 22 }, { width: 22 }, { width: 16 }];

    ws.mergeCells('B2:E2');
    const r2 = ws.getCell('B2');
    r2.value = `${idEmp.nombre} · ${TITULO.toUpperCase()}`;
    r2.font = { name: 'Arial', size: 14, bold: true, color: { argb: NAR } };

    ws.mergeCells('B3:E3');
    const r3 = ws.getCell('B3');
    r3.value = `Período: ${fmtFecha(meta.desde)} al ${fmtFecha(meta.hasta)} | Tasa BCV: Bs ${fmtNum(meta.tasaBcv)} / $ | Emitido: ${new Date().toLocaleString('es-VE')}`;
    r3.font = { name: 'Arial', size: 9, italic: true, color: { argb: 'FF64748B' } };

    // KPIs
    const kpis = kpisDeResumen(resumen, meta);
    kpis.forEach((k, i) => {
      const col = String.fromCharCode(66 + i);
      const label = ws.getCell(`${col}5`);
      label.value = k.label;
      label.font = { name: 'Arial', size: 8, bold: true, color: { argb: 'FF475569' } };
      label.alignment = { horizontal: 'center' };
      label.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      const val = ws.getCell(`${col}6`);
      val.value = `${k.val}${k.sub ? `\n${k.sub}` : ''}`;
      val.font = { name: 'Arial', size: 11, bold: true, color: { argb: NAR } };
      val.alignment = { horizontal: 'center', wrapText: true };
    });

    let row = 8;
    const bloque = (titulo: string, cols: string[], datos: (string | number)[][]) => {
      ws.getCell(`B${row}`).value = titulo;
      ws.getCell(`B${row}`).font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF1E293B' } };
      row += 1;
      const head = ws.getRow(row);
      cols.forEach((c, i) => {
        const cell = head.getCell(2 + i);
        cell.value = c;
        cell.font = { name: 'Arial', size: 8.5, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAR } };
        cell.alignment = { horizontal: i === 0 ? 'left' : 'right' };
      });
      row += 1;
      for (const fila of datos) {
        const r = ws.getRow(row);
        fila.forEach((v, i) => {
          const cell = r.getCell(2 + i);
          cell.value = v;
          cell.font = { name: 'Arial', size: 8.5, color: { argb: 'FF334155' } };
          cell.alignment = { horizontal: i === 0 ? 'left' : 'right' };
        });
        row += 1;
      }
      row += 1;
    };

    bloque(
      `RANKING DE DEPARTAMENTOS POR GASTO (${AVISO_RANKING})`,
      ['Departamento', 'Gasto ($)', 'Gasto (Bs)', '% del Total'],
      resumen.rankingDeptoGasto.map((d) => [d.departamento, d.usd, d.bs, `${d.pct.toFixed(1)}%`]),
    );
    if (resumen.comprasDirectasPorCategoriaGasto.length) {
      bloque(
        `COMPRAS DIRECTAS POR CATEGORÍA DE GASTO (total: ${fmtUsd(resumen.totalDirectasUsd)} · ${fmtBs(resumen.totalDirectasBs)})`,
        ['Categoría de gasto', 'Gasto ($)', 'Gasto (Bs)'],
        resumen.comprasDirectasPorCategoriaGasto.map((c) => [c.categoria, c.usd, c.bs]),
      );
    }
    if (resumen.rankingDeptoCotizaciones.length) {
      bloque(
        'DEPARTAMENTOS POR COTIZACIONES MOVIDAS',
        ['Departamento', 'Cotizaciones'],
        resumen.rankingDeptoCotizaciones.map((d) => [d.departamento, d.cotizaciones]),
      );
    }
    bloque(
      'TOP CATEGORÍAS DE INVENTARIO (POR MONTO)',
      ['Categoría', 'Monto ($)'],
      resumen.topCategorias.map((t) => [t.nombre, t.usd]),
    );
    bloque(
      'TOP ÍTEMS (POR MONTO)',
      ['Ítem', 'Monto ($)', 'Cantidad'],
      resumen.topItems.map((t) => [t.nombre, t.usd, t.cantidad ?? 0]),
    );
    if (meta.incluirCreditos !== false && (resumen.cuentasCredito?.length ?? 0) > 0) {
      bloque(
        `CUENTAS A CRÉDITO COMPRAS · OC Y OS (${resumen.creditosCount} · OC: ${resumen.creditosOcCount}, OS: ${resumen.creditosOsCount})`,
        ['Código / Tipo', 'Saldo Pendiente ($)', 'Saldo Pendiente (Bs)'],
        resumen.cuentasCredito.map((c) => [`[${c.tipo}] ${c.codigo} · ${c.proveedor}`, c.saldo_usd, c.saldo_bs]),
      );
    }
  }

  // 1b. Hoja dedicada «Cuentas a Crédito» (OC y OS de Compras)
  if (meta.incluirCreditos !== false && (resumen.cuentasCredito?.length ?? 0) > 0) {
    const wc = wb.addWorksheet('Cuentas a Crédito', {
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
      views: [{ state: 'frozen', ySplit: 5 }],
    });
    const colsCred = [
      { label: 'Tipo', width: 10, align: 'center' as const },
      { label: 'Código', width: 18, align: 'left' as const },
      { label: 'Fecha', width: 13, align: 'center' as const },
      { label: 'Departamento', width: 22, align: 'left' as const },
      { label: 'Proveedor', width: 28, align: 'left' as const },
      { label: 'Analista', width: 20, align: 'left' as const },
      { label: 'Total ($)', width: 16, align: 'right' as const },
      { label: 'Abonado ($)', width: 16, align: 'right' as const },
      { label: 'Saldo Pendiente ($)', width: 18, align: 'right' as const },
      { label: 'Saldo Pendiente (Bs)', width: 20, align: 'right' as const },
    ];
    wc.columns = [{ width: 4 }, ...colsCred.map((c) => ({ width: c.width }))];
    wc.mergeCells(2, 2, 2, colsCred.length + 1);
    const tCred = wc.getCell(2, 2);
    tCred.value = `${idEmp.nombre} · CUENTAS A CRÉDITO DESDE COMPRAS (OC Y OS)`;
    tCred.font = { name: 'Arial', size: 13, bold: true, color: { argb: 'FFB91C1C' } };

    wc.mergeCells(3, 2, 3, colsCred.length + 1);
    const sCred = wc.getCell(3, 2);
    sCred.value = `Cuentas abiertas: ${resumen.creditosCount} (OC: ${resumen.creditosOcCount} · OS: ${resumen.creditosOsCount}) | Saldo total: $${resumen.creditosSaldoUsd.toFixed(2)} | Tasa BCV: Bs ${fmtNum(meta.tasaBcv)}/$`;
    sCred.font = { name: 'Arial', size: 8.5, italic: true, color: { argb: 'FF64748B' } };

    const hr = wc.getRow(5);
    hr.height = 24;
    colsCred.forEach((c, idx) => {
      const cell = hr.getCell(idx + 2);
      cell.value = c.label;
      cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB91C1C' } };
      cell.alignment = { horizontal: c.align, vertical: 'middle', wrapText: true };
    });

    resumen.cuentasCredito.forEach((c, idx) => {
      const r = wc.getRow(6 + idx);
      r.height = 18;
      const vals = [c.tipo, c.codigo, fmtFecha(c.fecha), c.departamento, c.proveedor, c.analista || '-', c.total_usd, c.abonado_usd, c.saldo_usd, c.saldo_bs];
      vals.forEach((v, ci) => {
        const cell = r.getCell(ci + 2);
        cell.value = v;
        if (ci >= 6 && ci <= 8) cell.numFmt = '"$"#,##0.00';
        else if (ci === 9) cell.numFmt = '"Bs "#,##0.00';
        cell.font = { name: 'Arial', size: 8.5, bold: ci === 0 || ci === 8, color: { argb: 'FF1E293B' } };
        cell.alignment = { horizontal: colsCred[ci].align, vertical: 'middle' };
        if (idx % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF2F2' } };
      });
    });

    const tr = wc.getRow(6 + resumen.cuentasCredito.length);
    tr.height = 22;
    colsCred.forEach((c, ci) => {
      const cell = tr.getCell(ci + 2);
      cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF991B1B' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
      cell.alignment = { horizontal: c.align, vertical: 'middle' };
      if (ci === 0) cell.value = 'TOTAL';
      else if (ci === 1) cell.value = `OC: ${resumen.creditosOcCount} · OS: ${resumen.creditosOsCount}`;
      else if (ci === 6) { cell.value = resumen.creditosTotalUsd; cell.numFmt = '"$"#,##0.00'; }
      else if (ci === 7) { cell.value = resumen.creditosAbonadoUsd; cell.numFmt = '"$"#,##0.00'; }
      else if (ci === 8) { cell.value = resumen.creditosSaldoUsd; cell.numFmt = '"$"#,##0.00'; }
      else if (ci === 9) { cell.value = resumen.creditosSaldoBs; cell.numFmt = '"Bs "#,##0.00'; }
    });
  }

  // 2. Hoja de datos (listado)
  if (incluyeDetalle(meta) && columnas.length) {
    const orient = meta.orientacion === 'portrait' ? 'portrait' : meta.orientacion === 'landscape' ? 'landscape' : columnas.length > 7 ? 'landscape' : 'portrait';
    const ws = wb.addWorksheet('Compras', {
      pageSetup: { orientation: orient, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
      views: [{ state: 'frozen', ySplit: 5 }],
    });
    ws.columns = [{ width: 4 }, ...columnas.map((c) => ({ width: Math.max(c.anchoExcel, c.etiqueta.length + 4) }))];

    ws.mergeCells(2, 2, 2, columnas.length + 1);
    const tit = ws.getCell(2, 2);
    tit.value = `${idEmp.nombre} · ${TITULO.toUpperCase()}`;
    tit.font = { name: 'Arial', size: 13, bold: true, color: { argb: NAR } };

    ws.mergeCells(3, 2, 3, columnas.length + 1);
    const sub = ws.getCell(3, 2);
    sub.value = `Período: ${fmtFecha(meta.desde)} al ${fmtFecha(meta.hasta)} | Agrupación: ${meta.agrupacion.toUpperCase()}${meta.subtituloFiltros ? ` | ${meta.subtituloFiltros}` : ''}`;
    sub.font = { name: 'Arial', size: 8.5, italic: true, color: { argb: 'FF64748B' } };

    const headerRow = ws.getRow(5);
    headerRow.height = 24;
    columnas.forEach((col, idx) => {
      const cell = headerRow.getCell(idx + 2);
      cell.value = col.etiqueta;
      cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAR } };
      cell.alignment = { horizontal: col.alineacion, vertical: 'middle', wrapText: true };
    });

    filas.forEach((f, fIdx) => {
      const r = ws.getRow(6 + fIdx);
      r.height = 18;
      const esPar = fIdx % 2 === 1;
      columnas.forEach((col, cIdx) => {
        const cell = r.getCell(cIdx + 2);
        if (col.formato === 'moneda' || col.formato === 'numero') {
          const n = numeroDeColumna(f, col.clave);
          cell.value = n ?? 0;
          cell.numFmt = col.formato === 'moneda' ? (col.clave === 'monto_bs' ? '"Bs "#,##0.00' : '"$"#,##0.00') : '#,##0.00';
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
      });
    });

    // Totales
    const totUsd = filas.reduce((a, f) => a + (f.monto_usd || 0), 0);
    const totBs = filas.reduce((a, f) => a + (f.monto_bs || 0), 0);
    const totCant = filas.reduce((a, f) => a + (f.cantidad ?? 0), 0);
    const totRow = ws.getRow(6 + filas.length);
    totRow.height = 22;
    columnas.forEach((col, cIdx) => {
      const cell = totRow.getCell(cIdx + 2);
      cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF1E293B' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      cell.alignment = { horizontal: col.alineacion, vertical: 'middle' };
      if (cIdx === 0) cell.value = 'TOTALES';
      else if (col.clave === 'monto_usd') { cell.value = totUsd; cell.numFmt = '"$"#,##0.00'; }
      else if (col.clave === 'monto_bs') { cell.value = totBs; cell.numFmt = '"Bs "#,##0.00'; }
      else if (col.clave === 'cantidad') { cell.value = totCant; cell.numFmt = '#,##0.00'; }
    });
  }

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

export async function descargarComprasExcel(
  filas: FilaReporteCompras[],
  resumen: ResumenReporteCompras,
  columnasClaves: string[],
  meta: MetadatosExportacionCompras,
): Promise<void> {
  const bytes = await construirComprasExcel(filas, resumen, columnasClaves, meta);
  await previewExcelArchivo(bytes, `compras-${meta.ambito}-${hoyStr()}.xlsx`);
}

/* ============================================================
   2. PDF (jsPDF + autotable)
   (Actualizado 11/11/2026: Tipografía incrementada un 15%, ranking unificado,
    listado de pendientes, y tabla final de trazabilidad integral con notas
    y desglose puntual de ítems para todas las compras)
   ============================================================ */

/** Helper para dibujar el encabezado formal de sección con acento vertical naranja (+15% tipografía) */
function dibujarHeaderSeccion(
  doc: jsPDF,
  titulo: string,
  subtitulo: string | null,
  M: number,
  y: number,
  NARANJA: [number, number, number],
  TINTA: [number, number, number],
  GRIS_TEXTO: [number, number, number],
): number {
  const maxW = doc.internal.pageSize.getWidth() - M * 2;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.8);
  const titleW = doc.getTextWidth(pdfSafe(titulo));

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.6);
  const subW = subtitulo ? doc.getTextWidth(pdfSafe(subtitulo)) : 0;

  // Si cabe en una sola línea (ej. en landscape o subtítulos cortos)
  if (!subtitulo || (M + 7 + titleW + 8 + subW <= doc.internal.pageSize.getWidth() - M)) {
    doc.setFillColor(...NARANJA);
    doc.rect(M, y, 3.5, 12, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.8);
    doc.setTextColor(...TINTA);
    doc.text(pdfSafe(titulo), M + 7, y + 8.5);

    if (subtitulo) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.6);
      doc.setTextColor(...GRIS_TEXTO);
      doc.text(pdfSafe(subtitulo), M + 7 + titleW + 8, y + 8.5);
    }
    return y + 16;
  }

  // Si no cabe en una sola línea (ej. portrait con subtítulo largo): dos renglones limpios
  doc.setFillColor(...NARANJA);
  doc.rect(M, y, 3.5, 21, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.8);
  doc.setTextColor(...TINTA);
  doc.text(pdfSafe(titulo), M + 7, y + 8.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...GRIS_TEXTO);

  let subTxt = pdfSafe(subtitulo);
  if (doc.getTextWidth(subTxt) > maxW - 10) {
    while (subTxt.length > 3 && doc.getTextWidth(subTxt + '…') > maxW - 10) {
      subTxt = subTxt.slice(0, -1);
    }
    subTxt += '…';
  }
  doc.text(subTxt, M + 7, y + 18.0);

  return y + 26;
}

export async function construirComprasPdf(
  filas: FilaReporteCompras[],
  resumen: ResumenReporteCompras,
  columnasClaves: string[],
  meta: MetadatosExportacionCompras,
): Promise<jsPDF> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const columnas = columnasVisibles(columnasClaves, meta);
  const orient =
    meta.orientacion === 'portrait'
      ? 'portrait'
      : meta.orientacion === 'landscape'
        ? 'landscape'
        : columnas.length > 6
          ? 'landscape'
          : 'portrait';

  const esLandscape = orient === 'landscape';
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: orient });
  const PAGE_W = doc.internal.pageSize.getWidth();
  const PAGE_H = doc.internal.pageSize.getHeight();
  const MARGIN = esLandscape ? 32 : 28;
  const UW = PAGE_W - MARGIN * 2;
  let y = MARGIN;

  const idEmp = identidadEmpresa();
  const logo = await loadLogoPdfEmpresa().catch(() => null);

  // Paleta corporativa MGG
  const NARANJA_GT: [number, number, number] = [255, 138, 0];
  const VERDE_GT: [number, number, number] = [22, 101, 52];
  const AZUL_GT: [number, number, number] = [2, 132, 199];
  const AMBAR_GT: [number, number, number] = [245, 158, 11];
  const TINTA_GT: [number, number, number] = [30, 41, 59];
  const GRIS_TEXTO_GT: [number, number, number] = [100, 116, 139];
  const GRIS_CLARO_GT: [number, number, number] = [148, 163, 184];
  const BORDE_GT: [number, number, number] = [226, 232, 240];
  const FONDO_SUAVE_GT: [number, number, number] = [250, 247, 245];
  const FONDO_ALT_GT: [number, number, number] = [254, 252, 248];

  const colores = {
    NARANJA: NARANJA_GT,
    VERDE: VERDE_GT,
    AZUL: AZUL_GT,
    AMBAR: AMBAR_GT,
    TINTA: TINTA_GT,
    GRIS_TEXTO: GRIS_TEXTO_GT,
    GRIS_CLARO: GRIS_CLARO_GT,
    BORDE: BORDE_GT,
    FONDO_SUAVE: FONDO_SUAVE_GT,
    FONDO_ALT: FONDO_ALT_GT,
  };

  // Fecha y hora formateada en español
  const ahoraDate = new Date();
  const meses = ['ene.', 'feb.', 'mar.', 'abr.', 'may.', 'jun.', 'jul.', 'ago.', 'sep.', 'oct.', 'nov.', 'dic.'];
  const dia = ahoraDate.getDate();
  const mes = meses[ahoraDate.getMonth()];
  const anio = ahoraDate.getFullYear();
  let h = ahoraDate.getHours();
  const mMin = String(ahoraDate.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'p. m.' : 'a. m.';
  h = h % 12 || 12;
  const fechaHoraEmision = `${dia} ${mes} ${anio}, ${h}:${mMin} ${ampm}`;

  // 1. MEMBRETE DUAL INSTITUCIONAL (+15% tipografía)
  const cajaLogo = esLandscape ? 42 : 40;
  if (logo) {
    dibujarLogoPdf(doc, logo, MARGIN, y, cajaLogo);
  }
  const tx = logo ? MARGIN + anchoLogoPdf(cajaLogo) + 12 : MARGIN;

  // Lado izquierdo: datos corporativos MGG
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(esLandscape ? 12.5 : 12.0); // +15%
  doc.setTextColor(...TINTA_GT);
  doc.text(idEmp.nombre || EMPRESA_NOMBRE, tx, y + 11.5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.3); // +15%
  doc.setTextColor(...GRIS_TEXTO_GT);
  doc.text('EXTRACCIÓN Y PROCESAMIENTO DE MINERALES', tx, y + 22.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.0); // +15%
  doc.setTextColor(...GRIS_TEXTO_GT);
  doc.text(`RIF: ${idEmp.rif || EMPRESA_RIF} · Puerto Ordaz`, tx, y + 32.5);

  doc.setFontSize(7.8); // +15%
  doc.setTextColor(...GRIS_CLARO_GT);
  doc.text('ESTADO BOLÍVAR · VENEZUELA', tx, y + 41.5);

  // Lado derecho: Caja ejecutiva formal de metadatos del reporte
  const boxW = Math.min(255, Math.max(215, UW * 0.38));
  const boxH = 50;
  const bx = PAGE_W - MARGIN - boxW;

  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(...BORDE_GT);
  doc.setLineWidth(0.6);
  doc.roundedRect(bx, y, boxW, boxH, 3, 3, 'FD');

  const barH = 15;
  doc.setFillColor(...NARANJA_GT);
  doc.roundedRect(bx, y, boxW, barH, 3, 3, 'F');
  doc.rect(bx, y + barH - 3, boxW, 3, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.3); // +15%
  doc.setTextColor(255, 255, 255);
  doc.text(meta.ambito === 'creditos' ? 'CUENTAS A CRÉDITO (OC / OS)' : 'REPORTE DE COMPRAS', bx + boxW / 2, y + 10.5, { align: 'center' });

  // Filas internas alineadas
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5); // +15%
  doc.setTextColor(...GRIS_TEXTO_GT);
  doc.text('EMITIDO:', bx + 8, y + 24.0);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...TINTA_GT);
  doc.text(fechaHoraEmision, bx + 55, y + 24.0);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...GRIS_TEXTO_GT);
  doc.text('PERÍODO:', bx + 8, y + 34.0);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...TINTA_GT);
  let perTxt = pdfSafe(`${fmtFecha(meta.desde)} al ${fmtFecha(meta.hasta)}`);
  if (doc.getTextWidth(perTxt) > boxW - 62) {
    while (perTxt.length > 3 && doc.getTextWidth(perTxt + '…') > boxW - 62) {
      perTxt = perTxt.slice(0, -1);
    }
    perTxt += '…';
  }
  doc.text(perTxt, bx + 55, y + 34.0);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...GRIS_TEXTO_GT);
  doc.text('REGISTROS:', bx + 8, y + 44.0);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...TINTA_GT);
  doc.text(
    meta.ambito === 'creditos'
      ? `${resumen.creditosCount} cuentas (OC: ${resumen.creditosOcCount} · OS: ${resumen.creditosOsCount})`
      : `${resumen.totalCompras} compras (${filas.length} en listado)`,
    bx + 55,
    y + 44.0,
  );

  y = Math.max(y + cajaLogo + 8, y + boxH + 10);

  // 2. CINTILLO DE ALCANCE DEL REPORTE (A todo el ancho útil)
  const stripH = 19;
  doc.setFillColor(...FONDO_SUAVE_GT);
  doc.setDrawColor(...BORDE_GT);
  doc.setLineWidth(0.5);
  doc.roundedRect(MARGIN, y, UW, stripH, 2.5, 2.5, 'FD');

  doc.setFillColor(...NARANJA_GT);
  doc.roundedRect(MARGIN, y, 3.5, stripH, 2.5, 2.5, 'F');
  doc.rect(MARGIN + 2, y, 1.5, stripH, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.0); // +15%
  doc.setTextColor(...NARANJA_GT);
  doc.text('ALCANCE DEL REPORTE:', MARGIN + 8, y + 12.5);
  const alcW = doc.getTextWidth('ALCANCE DEL REPORTE:');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.0); // +15%
  doc.setTextColor(...TINTA_GT);
  const descFiltros = meta.subtituloFiltros ? ` · Filtros: ${meta.subtituloFiltros}` : '';
  const ambitoLabel = meta.ambito === 'creditos' ? 'CUENTAS A CRÉDITO (OC Y OS)' : meta.ambito === 'ordenes' ? 'ÓRDENES DE COMPRA' : 'ÍTEMS';
  const formatoLabel = meta.formato === 'hibrido' ? 'CONSOLIDADO' : meta.formato.toUpperCase();
  const textoAlcance = pdfSafe(
    `Ámbito: ${ambitoLabel} · Agrupación: ${meta.agrupacion.toUpperCase()} · Formato: ${formatoLabel} · Tasa BCV: Bs ${fmtNum(meta.tasaBcv)}/$${descFiltros}`,
  );
  doc.text(textoAlcance, MARGIN + 8 + alcW + 5, y + 12.5);

  y += stripH + 9;

  // 3. TARJETAS DE KPIS SUPERIORES (+15% tipografía)
  const cardGap = 6;
  const numKpis = 4;
  const cardW = (UW - cardGap * (numKpis - 1)) / numKpis;
  const cardH = esLandscape ? 44 : 45;

  const kpis = meta.ambito === 'creditos'
    ? [
        {
          titulo: 'CUENTAS A CRÉDITO (OC / OS)',
          valor: `${fmtNum(resumen.creditosCount, 0)}`,
          sub: `OC: ${resumen.creditosOcCount} · OS: ${resumen.creditosOsCount}`,
          colorTab: NARANJA_GT,
        },
        {
          titulo: 'MONTO ORIGINAL',
          valor: fmtUsd(resumen.creditosTotalUsd),
          sub: fmtBs(resumen.creditosTotalBs),
          colorTab: AZUL_GT,
        },
        {
          titulo: 'TOTAL ABONADO',
          valor: fmtUsd(resumen.creditosAbonadoUsd),
          sub: fmtBs(resumen.creditosAbonadoBs),
          colorTab: VERDE_GT,
        },
        {
          titulo: 'SALDO PENDIENTE',
          valor: fmtUsd(resumen.creditosSaldoUsd),
          sub: fmtBs(resumen.creditosSaldoBs),
          colorTab: [185, 28, 28] as [number, number, number],
        },
      ]
    : [
        {
          titulo: 'TOTAL DE COMPRAS',
          valor: `${fmtNum(resumen.totalCompras, 0)}`,
          sub: `${fmtUsd(resumen.totalUsd)} · ${fmtBs(resumen.totalBs)}`,
          colorTab: NARANJA_GT,
        },
        {
          titulo: 'COMPRAS FINALIZADAS',
          valor: `${fmtNum(resumen.finalizadasCount, 0)}`,
          sub: `${fmtUsd(resumen.finalizadasUsd)} · ${fmtBs(resumen.finalizadasBs)}`,
          colorTab: VERDE_GT,
        },
        {
          titulo: 'COMPRAS PENDIENTES',
          valor: `${fmtNum(resumen.pendientesCount, 0)}`,
          sub: `${fmtUsd(resumen.pendientesUsd)} · ${fmtBs(resumen.pendientesBs)}`,
          colorTab: AMBAR_GT,
        },
        {
          titulo: 'TOTAL PAGADO / ABONADO',
          valor: fmtUsd(resumen.pagadoUsd),
          sub: `${fmtBs(resumen.pagadoBs)}${resumen.deptoQueMasGasto ? ` · Mayor: ${resumen.deptoQueMasGasto}` : ''}`,
          colorTab: AZUL_GT,
        },
      ];

  kpis.forEach((kpi, idx) => {
    const kx = MARGIN + idx * (cardW + cardGap);
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(...BORDE_GT);
    doc.setLineWidth(0.6);
    doc.roundedRect(kx, y, cardW, cardH, 2.5, 2.5, 'FD');

    // Pestaña superior de color
    doc.setFillColor(...kpi.colorTab);
    doc.roundedRect(kx, y, cardW, 2.5, 1, 1, 'F');

    // Título de la tarjeta
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.1); // +15%
    doc.setTextColor(...GRIS_TEXTO_GT);
    doc.text(pdfSafe(kpi.titulo), kx + 6, y + 10.5);

    // Valor prominente
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(esLandscape ? 12.0 : 11.0); // +15%
    doc.setTextColor(...TINTA_GT);
    doc.text(pdfSafe(kpi.valor), kx + 6, y + (esLandscape ? 23.0 : 22.5));

    // Subtítulo
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(esLandscape ? 6.7 : 6.2); // +15%
    doc.setTextColor(...GRIS_CLARO_GT);
    let subTxt = pdfSafe(kpi.sub);
    if (doc.getTextWidth(subTxt) > cardW - 12) {
      while (subTxt.length > 3 && doc.getTextWidth(subTxt + '…') > cardW - 12) {
        subTxt = subTxt.slice(0, -1);
      }
      subTxt += '…';
    }
    doc.text(subTxt, kx + 6, y + (esLandscape ? 33.5 : 33.0));
  });

  y += cardH + 13;

  let seccionNum = 1;

  // 4. ANALÍTICA (Resumen e Híbrido / Consolidado; se omite si el ámbito es exclusivamente créditos)
  if (incluyeResumen(meta) && meta.ambito !== 'creditos') {
    const resBloque = bloqueResumenPdf(
      doc,
      autoTable,
      resumen,
      meta,
      MARGIN,
      UW,
      PAGE_W,
      PAGE_H,
      y,
      esLandscape,
      colores,
      seccionNum,
    );
    y = resBloque.y;
    seccionNum = resBloque.siguienteSeccion;
  }

  // 4b. CUENTAS A CRÉDITO ORIGINADAS EN COMPRAS (OC Y OS)
  const cuentasCreditoPdf = meta.incluirCreditos !== false ? (resumen.cuentasCredito ?? []) : [];
  if (cuentasCreditoPdf.length > 0) {
    if (y + 65 > PAGE_H - MARGIN) {
      doc.addPage();
      y = MARGIN;
    }

    const ROJO_CRED: [number, number, number] = [185, 28, 28];
    const partesSaldo: string[] = [];
    if (meta.mostrarUsd) partesSaldo.push(fmtUsd(resumen.creditosSaldoUsd));
    if (meta.mostrarBs) partesSaldo.push(fmtBs(resumen.creditosSaldoBs));

    y = dibujarHeaderSeccion(
      doc,
      `${seccionNum++}. Cuentas a Crédito desde Compras · OC y OS (${cuentasCreditoPdf.length} cuentas)`,
      `OC: ${resumen.creditosOcCount} · OS: ${resumen.creditosOsCount} · Se saldan por abonos · Saldo pendiente: ${partesSaldo.join(' · ')}`,
      MARGIN,
      y,
      ROJO_CRED,
      TINTA_GT,
      GRIS_TEXTO_GT,
    );

    const headCred: string[] = ['#', 'Tipo', 'Código', 'Fecha', 'Departamento', 'Proveedor'];
    if (meta.mostrarUsd) {
      headCred.push('Total ($)', 'Abonado ($)', 'Saldo ($)');
    } else if (meta.mostrarBs) {
      headCred.push('Total (Bs)', 'Abonado (Bs)');
    }
    if (meta.mostrarBs) {
      headCred.push('Saldo (Bs)');
    }

    const bodyCred = cuentasCreditoPdf.map((c, idx) => {
      const row: string[] = [
        String(idx + 1),
        c.tipo,
        pdfSafe(c.codigo),
        fmtFecha(c.fecha),
        pdfSafe(c.departamento),
        pdfSafe(c.proveedor),
      ];
      if (meta.mostrarUsd) {
        row.push(fmtUsd(c.total_usd), fmtUsd(c.abonado_usd), fmtUsd(c.saldo_usd));
      } else if (meta.mostrarBs) {
        row.push(fmtBs(c.total_bs), fmtBs(c.abonado_bs));
      }
      if (meta.mostrarBs) {
        row.push(fmtBs(c.saldo_bs));
      }
      return row;
    });

    const footCred: Array<string | { content: string; colSpan?: number; styles?: Record<string, unknown> }> = [
      {
        content: `TOTAL CUENTAS A CRÉDITO (OC: ${resumen.creditosOcCount} · OS: ${resumen.creditosOsCount})`,
        colSpan: 6,
        styles: { halign: 'left' as const, fontStyle: 'bold' as const },
      },
    ];
    if (meta.mostrarUsd) {
      footCred.push(
        { content: fmtUsd(resumen.creditosTotalUsd), styles: { halign: 'right' as const, fontStyle: 'bold' as const } },
        { content: fmtUsd(resumen.creditosAbonadoUsd), styles: { halign: 'right' as const, fontStyle: 'bold' as const } },
        { content: fmtUsd(resumen.creditosSaldoUsd), styles: { halign: 'right' as const, fontStyle: 'bold' as const } },
      );
    } else if (meta.mostrarBs) {
      footCred.push(
        { content: fmtBs(resumen.creditosTotalBs), styles: { halign: 'right' as const, fontStyle: 'bold' as const } },
        { content: fmtBs(resumen.creditosAbonadoBs), styles: { halign: 'right' as const, fontStyle: 'bold' as const } },
      );
    }
    if (meta.mostrarBs) {
      footCred.push({ content: fmtBs(resumen.creditosSaldoBs), styles: { halign: 'right' as const, fontStyle: 'bold' as const } });
    }

    const colStylesCred: Record<number, Record<string, unknown>> = {
      0: { cellWidth: esLandscape ? 20 : 16, halign: 'center' },
      1: { cellWidth: esLandscape ? 32 : 28, halign: 'center', fontStyle: 'bold' },
      2: { cellWidth: esLandscape ? 70 : 62, halign: 'center', fontStyle: 'bold' },
      3: { cellWidth: esLandscape ? 50 : 44, halign: 'center' },
      4: { halign: 'left' },
      5: { halign: 'left' },
    };
    let nextColIdx = 6;
    if (meta.mostrarUsd) {
      colStylesCred[nextColIdx++] = { cellWidth: esLandscape ? 66 : 52, halign: 'right' };
      colStylesCred[nextColIdx++] = { cellWidth: esLandscape ? 66 : 52, halign: 'right' };
      colStylesCred[nextColIdx++] = { cellWidth: esLandscape ? 70 : 56, halign: 'right', fontStyle: 'bold' };
    } else if (meta.mostrarBs) {
      colStylesCred[nextColIdx++] = { cellWidth: esLandscape ? 82 : 66, halign: 'right' };
      colStylesCred[nextColIdx++] = { cellWidth: esLandscape ? 82 : 66, halign: 'right' };
    }
    if (meta.mostrarBs) {
      colStylesCred[nextColIdx++] = { cellWidth: esLandscape ? 84 : 66, halign: 'right', fontStyle: 'bold' };
    }

    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN, bottom: 24 },
      head: [headCred],
      body: bodyCred,
      foot: [footCred as unknown as string[]],
      theme: 'grid',
      styles: {
        fontSize: esLandscape ? 8.1 : 7.3,
        cellPadding: { top: 2.2, bottom: 2.8, left: 2.5, right: 2.5 },
        lineColor: BORDE_GT,
        lineWidth: 0.3,
        textColor: TINTA_GT,
        overflow: 'linebreak',
        valign: 'middle',
      },
      headStyles: {
        fillColor: ROJO_CRED,
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        halign: 'center',
        cellPadding: { top: 2.4, bottom: 3.0, left: 2.5, right: 2.5 },
        fontSize: esLandscape ? 8.1 : 7.3,
      },
      footStyles: {
        fillColor: [254, 226, 226],
        textColor: [153, 27, 27],
        fontStyle: 'bold',
        fontSize: esLandscape ? 8.1 : 7.3,
      },
      alternateRowStyles: { fillColor: [254, 242, 242] },
      columnStyles: colStylesCred,
    });

    const lastCred = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
    y = (lastCred?.finalY ?? y) + 14;
  } else if (meta.ambito === 'creditos') {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(esLandscape ? 9.0 : 8.5);
    doc.setTextColor(...VERDE_GT);
    doc.text('✓ No hay órdenes de compra (OC) ni órdenes de servicio (OS) con cuenta a crédito abierta.', MARGIN + 4, y + 10);
    y += 24;
  }

  // 5. LISTADO DE COMPRAS PENDIENTES CON ANALISTA, CÓDIGO Y MONTOS
  if (incluyeDetalle(meta) && meta.ambito !== 'creditos') {
    if (y + 60 > PAGE_H - MARGIN) {
      doc.addPage();
      y = MARGIN;
    }

    const comprasPendientes = filas.filter((f) => f.clase_estado === 'pendiente');

    y = dibujarHeaderSeccion(
      doc,
      `${seccionNum++}. Listado de Compras Pendientes (${comprasPendientes.length} órdenes)`,
      `Órdenes de compra y compras en proceso o pendientes de pago · Total pendiente: ${fmtUsd(resumen.pendientesUsd)} · ${fmtBs(resumen.pendientesBs)}`,
      MARGIN,
      y,
      NARANJA_GT,
      TINTA_GT,
      GRIS_TEXTO_GT,
    );

    if (comprasPendientes.length > 0) {
      const headPend = ['#', 'Código', 'Fecha', 'Departamento', 'Proveedor', 'Analista', 'Estado', 'Monto ($)', 'Monto (Bs)'];
      const bodyPend = comprasPendientes.map((p, idx) => [
        String(idx + 1),
        pdfSafe(p.codigo),
        fmtFecha(p.fecha),
        pdfSafe(p.departamento),
        pdfSafe(p.proveedor),
        pdfSafe(p.analista || '—'),
        pdfSafe(p.estado_rotulo || p.estado),
        fmtUsd(p.monto_usd),
        fmtBs(p.monto_bs),
      ]);

      const totPendUsd = comprasPendientes.reduce((acc, p) => acc + (p.monto_usd || 0), 0);
      const totPendBs = comprasPendientes.reduce((acc, p) => acc + (p.monto_bs || 0), 0);

      const footPend = [
        {
          content: 'TOTAL PENDIENTES',
          colSpan: 5,
          styles: { halign: 'left' as const, fontStyle: 'bold' as const },
        },
        {
          content: `${comprasPendientes.length} compras`,
          styles: { halign: 'center' as const, fontStyle: 'bold' as const },
        },
        '',
        {
          content: fmtUsd(totPendUsd),
          styles: { halign: 'right' as const, fontStyle: 'bold' as const },
        },
        {
          content: fmtBs(totPendBs),
          styles: { halign: 'right' as const, fontStyle: 'bold' as const },
        },
      ];

      autoTable(doc, {
        startY: y,
        margin: { left: MARGIN, right: MARGIN, bottom: 24 },
        head: [headPend],
        body: bodyPend,
        foot: [footPend as unknown as string[]],
        theme: 'grid',
        styles: {
          fontSize: esLandscape ? 8.3 : 7.5, // +15%
          cellPadding: { top: 2.2, bottom: 2.8, left: 2.6, right: 2.6 },
          lineColor: BORDE_GT,
          lineWidth: 0.3,
          textColor: TINTA_GT,
          overflow: 'linebreak',
          valign: 'middle',
        },
        headStyles: {
          fillColor: NARANJA_GT,
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          halign: 'center',
          cellPadding: { top: 2.4, bottom: 3.0, left: 2.6, right: 2.6 },
          fontSize: esLandscape ? 8.3 : 7.5,
        },
        footStyles: {
          fillColor: [241, 245, 249],
          textColor: TINTA_GT,
          fontStyle: 'bold',
          fontSize: esLandscape ? 8.3 : 7.5,
        },
        alternateRowStyles: { fillColor: FONDO_ALT_GT },
        columnStyles: esLandscape
          ? {
              0: { cellWidth: 20, halign: 'center' },
              1: { cellWidth: 72, halign: 'center', fontStyle: 'bold' },
              2: { cellWidth: 50, halign: 'center' },
              3: { halign: 'left' },
              4: { halign: 'left' },
              5: { cellWidth: 90, halign: 'left', fontStyle: 'bold' },
              6: { cellWidth: 65, halign: 'center' },
              7: { cellWidth: 75, halign: 'right', fontStyle: 'bold' },
              8: { cellWidth: 85, halign: 'right' },
            }
          : {
              0: { cellWidth: 16, halign: 'center' },
              1: { cellWidth: 68, halign: 'center', fontStyle: 'bold' },
              2: { cellWidth: 46, halign: 'center' },
              3: { cellWidth: 78, halign: 'left' },
              4: { cellWidth: 88, halign: 'left' },
              5: { cellWidth: 66, halign: 'left', fontStyle: 'bold' },
              6: { cellWidth: 58, halign: 'center' },
              7: { cellWidth: 56, halign: 'right', fontStyle: 'bold' },
              8: { cellWidth: 68, halign: 'right' },
            },
      });

      const lastTableDet = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
      y = (lastTableDet?.finalY ?? y) + 14;
    } else {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(esLandscape ? 8.5 : 8.0);
      doc.setTextColor(...VERDE_GT);
      doc.text(
        `✓ No se registran compras pendientes en el período seleccionado. Todas las compras (${resumen.totalCompras}) se encuentran finalizadas y pagadas.`,
        MARGIN + 4,
        y + 6,
      );
      y += 20;
    }

    // 6. TABLA FINAL: TRAZABILIDAD INTEGRAL DE TODAS LAS COMPRAS (ÍTEMS + NOTAS)
    // Aborda a todas las compras en una tabla exhaustiva de auditoría
    if (!esLandscape) {
      doc.addPage('letter', 'landscape');
      y = 32;
    } else if (y + 80 > PAGE_H - MARGIN) {
      doc.addPage();
      y = MARGIN;
    }

    const mLand = 32;
    y = dibujarHeaderSeccion(
      doc,
      `${seccionNum++}. Trazabilidad Consolidada de Todas las Compras (Ítems y Notas)`,
      `Auditoría exhaustiva de todas las compras del período con desglose puntual de ítems y notas · Total registros: ${filas.length}`,
      mLand,
      y,
      NARANJA_GT,
      TINTA_GT,
      GRIS_TEXTO_GT,
    );

    const headAll = [
      '#',
      'Código',
      'Fecha',
      'Departamento',
      'Proveedor',
      'Analista',
      'Estado',
      'Ítems Comprados',
      'Nota / Observación',
      'Monto ($)',
      'Monto (Bs)',
    ];

    const bodyAll = filas.map((p, idx) => {
      let itemsTxt = '—';
      if (p.items_lista && p.items_lista.length > 0) {
        itemsTxt = p.items_lista
          .map((it) => {
            const cant = it.cantidad > 0 ? `${fmtNum(it.cantidad, it.cantidad % 1 === 0 ? 0 : 2)} ${it.unidad || 'u.'}` : '';
            const pUnit = it.precio_unitario && it.precio_unitario > 0 ? ` (${fmtUsd(it.precio_unitario)})` : '';
            return `• ${cant ? `${cant} ` : ''}${it.nombre}${pUnit}`;
          })
          .join('\n');
      } else if (p.nombre_item) {
        itemsTxt = `• ${p.cantidad ? `${p.cantidad} u. ` : ''}${p.nombre_item}`;
      }

      return [
        String(idx + 1),
        pdfSafe(p.codigo),
        fmtFecha(p.fecha),
        pdfSafe(p.departamento),
        pdfSafe(p.proveedor),
        pdfSafe(p.analista || '—'),
        pdfSafe(p.estado_rotulo || p.estado),
        pdfSafe(itemsTxt),
        pdfSafe(p.notas || '—'),
        fmtUsd(p.monto_usd),
        fmtBs(p.monto_bs),
      ];
    });

    const totGenUsd = filas.reduce((acc, f) => acc + (f.monto_usd || 0), 0);
    const totGenBs = filas.reduce((acc, f) => acc + (f.monto_bs || 0), 0);

    const footAll = [
      {
        content: 'TOTAL GENERAL DE COMPRAS',
        colSpan: 5,
        styles: { halign: 'left' as const, fontStyle: 'bold' as const },
      },
      {
        content: `${filas.length} compras`,
        styles: { halign: 'center' as const, fontStyle: 'bold' as const },
      },
      '',
      '',
      '',
      {
        content: fmtUsd(totGenUsd),
        styles: { halign: 'right' as const, fontStyle: 'bold' as const },
      },
      {
        content: fmtBs(totGenBs),
        styles: { halign: 'right' as const, fontStyle: 'bold' as const },
      },
    ];

    autoTable(doc, {
      startY: y,
      margin: { left: mLand, right: mLand, bottom: 24 },
      head: [headAll],
      body: bodyAll,
      foot: [footAll as unknown as string[]],
      theme: 'grid',
      styles: {
        fontSize: 7.8, // +15%
        cellPadding: { top: 2.2, bottom: 2.6, left: 2.5, right: 2.5 },
        lineColor: BORDE_GT,
        lineWidth: 0.3,
        textColor: TINTA_GT,
        overflow: 'linebreak',
        valign: 'middle',
      },
      headStyles: {
        fillColor: [51, 65, 85], // Azul pizarra oscuro corporativo
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        halign: 'center',
        cellPadding: { top: 2.4, bottom: 3.0, left: 2.5, right: 2.5 },
        fontSize: 7.8,
      },
      footStyles: {
        fillColor: [241, 245, 249],
        textColor: TINTA_GT,
        fontStyle: 'bold',
        fontSize: 7.8,
      },
      alternateRowStyles: { fillColor: FONDO_ALT_GT },
      columnStyles: {
        0: { cellWidth: 18, halign: 'center' },
        1: { cellWidth: 52, halign: 'center', fontStyle: 'bold' },
        2: { cellWidth: 42, halign: 'center' },
        3: { cellWidth: 68, halign: 'left' },
        4: { cellWidth: 75, halign: 'left' },
        5: { cellWidth: 65, halign: 'left', fontStyle: 'bold' },
        6: { cellWidth: 50, halign: 'center' },
        7: { cellWidth: 155, halign: 'left' },
        8: { cellWidth: 75, halign: 'left' },
        9: { cellWidth: 58, halign: 'right', fontStyle: 'bold' },
        10: { cellWidth: 70, halign: 'right' },
      },
    });
  }

  // 7. PIES DE PÁGINA FORMALES MULTIPÁGINA (Dinámico por orientación de página)
  const numPaginas = doc.getNumberOfPages();
  for (let i = 1; i <= numPaginas; i++) {
    doc.setPage(i);
    const pW = doc.internal.pageSize.getWidth();
    const pH = doc.internal.pageSize.getHeight();
    const isLand = pW > pH;
    const m = isLand ? 32 : 28;

    doc.setDrawColor(...BORDE_GT);
    doc.setLineWidth(0.4);
    doc.line(m, pH - (isLand ? 20 : 18), pW - m, pH - (isLand ? 20 : 18));
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(isLand ? 8.0 : 7.5); // +15%
    doc.setTextColor(...GRIS_TEXTO_GT);
    doc.text(
      `Documento generado por el sistema · Reporte de Compras · ${idEmp.nombre} · RIF ${idEmp.rif}`,
      m,
      pH - (isLand ? 10 : 9),
    );
    doc.text(
      `Página ${i} de ${numPaginas}`,
      pW - m,
      pH - (isLand ? 10 : 9),
      { align: 'right' },
    );
  }

  return doc;
}

/**
 * Bloque de analítica: Fichas Top Gasto y Ranking Unificado
 * con Cotizaciones Movidas y Gasto en una sola tabla (+15% tipografía).
 */
function bloqueResumenPdf(
  doc: jsPDF,
  autoTable: typeof import('jspdf-autotable').default,
  r: ResumenReporteCompras,
  _meta: MetadatosExportacionCompras,
  M: number,
  UW: number,
  _PAGE_W: number,
  PAGE_H: number,
  y0: number,
  esLandscape: boolean,
  colores: {
    NARANJA: [number, number, number];
    VERDE: [number, number, number];
    AZUL: [number, number, number];
    AMBAR: [number, number, number];
    TINTA: [number, number, number];
    GRIS_TEXTO: [number, number, number];
    GRIS_CLARO: [number, number, number];
    BORDE: [number, number, number];
    FONDO_ALT: [number, number, number];
    FONDO_SUAVE: [number, number, number];
  },
  seccionInicial = 1,
): { y: number; siguienteSeccion: number } {
  let y = y0;
  let seccionNum = seccionInicial;

  // 1. Tarjetas híbridas de departamentos destacados (Top Gasto)
  const topDeptos = r.rankingDeptoGasto.slice(0, 6);
  if (topDeptos.length > 0) {
    if (y + 55 > PAGE_H - M) {
      doc.addPage();
      y = M;
    }
    y = dibujarHeaderSeccion(
      doc,
      'DISTRIBUCIÓN PUNTUAL POR DEPARTAMENTO · TOP GASTO',
      'Unidades solicitantes con mayor volumen presupuestario en el período',
      M,
      y,
      colores.NARANJA,
      colores.TINTA,
      colores.GRIS_TEXTO,
    );

    const colsFichas = esLandscape
      ? topDeptos.length <= 3
        ? topDeptos.length
        : 3
      : topDeptos.length <= 2
        ? topDeptos.length
        : 2;

    const cardGap = 6;
    const cardW = (UW - (colsFichas - 1) * cardGap) / colsFichas;
    const cardH = esLandscape ? 44 : 45;

    topDeptos.forEach((d, idx) => {
      const col = idx % colsFichas;
      const row = Math.floor(idx / colsFichas);
      const cardX = M + col * (cardW + cardGap);
      const cardY = y + row * (cardH + cardGap);

      // Tarjeta con fondo blanco y borde suave
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(...colores.BORDE);
      doc.setLineWidth(0.6);
      doc.roundedRect(cardX, cardY, cardW, cardH, 2.5, 2.5, 'FD');

      // Acento vertical izquierdo naranja
      doc.setFillColor(...colores.NARANJA);
      doc.rect(cardX, cardY, 2.5, cardH, 'F');

      // Fila 1: Nombre del departamento y Badge de %
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(esLandscape ? 8.3 : 7.8); // +15%
      doc.setTextColor(15, 23, 42);
      const maxLen = esLandscape ? 22 : 18;
      const nombreTruncado =
        d.departamento.length > maxLen
          ? d.departamento.slice(0, maxLen - 2) + '…'
          : d.departamento;
      doc.text(pdfSafe(nombreTruncado.toUpperCase()), cardX + 7, cardY + 10.0);

      // Badge a la derecha
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.9); // +15%
      doc.setTextColor(...colores.GRIS_TEXTO);
      doc.text(`${d.pct.toFixed(1)}%`, cardX + cardW - 6, cardY + 10.0, { align: 'right' });

      // Fila 2: Saldo en dólares prominente y valor en bolívares en verde
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(esLandscape ? 12.0 : 11.5); // +15%
      doc.setTextColor(...colores.NARANJA);
      doc.text(fmtUsd(d.usd), cardX + 7, cardY + (esLandscape ? 23.0 : 22.5));

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(esLandscape ? 8.6 : 8.0); // +15%
      doc.setTextColor(...colores.VERDE);
      let bsTxt = fmtBs(d.bs);
      if (doc.getTextWidth(bsTxt) > cardW * 0.48) {
        doc.setFontSize(esLandscape ? 7.5 : 7.0);
      }
      doc.text(bsTxt, cardX + cardW - 6, cardY + (esLandscape ? 22.5 : 22.0), { align: 'right' });

      // Fila 3: Detalle técnico inferior
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(esLandscape ? 6.7 : 6.2); // +15%
      doc.setTextColor(...colores.GRIS_TEXTO);
      doc.text('Gasto operativo consolidado', cardX + 7, cardY + (esLandscape ? 33.5 : 33.0));

      doc.text(
        `Participación: ${d.pct.toFixed(1)}%`,
        cardX + cardW - 6,
        cardY + (esLandscape ? 33.5 : 33.0),
        { align: 'right' },
      );

      // Mini-barra de progreso de participación en la base de la ficha
      const barY = cardY + cardH - 3;
      const barMaxW = cardW - 14;
      doc.setFillColor(241, 245, 249);
      doc.rect(cardX + 7, barY, barMaxW, 1.8, 'F');

      const barFillW = Math.max(1, Math.min(barMaxW, (d.pct / 100) * barMaxW));
      doc.setFillColor(...colores.NARANJA);
      doc.rect(cardX + 7, barY, barFillW, 1.8, 'F');
    });

    const totalFichasRows = Math.ceil(topDeptos.length / colsFichas);
    y += totalFichasRows * (cardH + cardGap) + 12;
  }

  // 2. TABLA UNIFICADA: Ranking de Departamentos por Gasto Y Cotizaciones Movidas (+15% tipografía)
  if (y + 60 > PAGE_H - M) {
    doc.addPage();
    y = M;
  }
  y = dibujarHeaderSeccion(
    doc,
    `${seccionNum++}. Ranking de Departamentos por Gasto y Cotizaciones Movidas`,
    'Distribución presupuestaria y actividad operativa por unidad solicitante',
    M,
    y,
    colores.NARANJA,
    colores.TINTA,
    colores.GRIS_TEXTO,
  );

  const cotizMap = new Map<string, number>();
  let totCotizaciones = 0;
  for (const c of r.rankingDeptoCotizaciones) {
    cotizMap.set(c.departamento, c.cotizaciones);
    totCotizaciones += c.cotizaciones;
  }

  const deptosUnificados: Array<{
    departamento: string;
    cotizaciones: number;
    usd: number;
    bs: number;
    pct: number;
  }> = [];

  const deptosProcesados = new Set<string>();

  for (const d of r.rankingDeptoGasto) {
    deptosProcesados.add(d.departamento);
    deptosUnificados.push({
      departamento: d.departamento,
      cotizaciones: cotizMap.get(d.departamento) || 0,
      usd: d.usd,
      bs: d.bs,
      pct: d.pct,
    });
  }

  for (const c of r.rankingDeptoCotizaciones) {
    if (!deptosProcesados.has(c.departamento)) {
      deptosProcesados.add(c.departamento);
      deptosUnificados.push({
        departamento: c.departamento,
        cotizaciones: c.cotizaciones,
        usd: 0,
        bs: 0,
        pct: 0,
      });
    }
  }

  const totDeptoUsd = r.rankingDeptoGasto.reduce((acc, d) => acc + (d.usd || 0), 0);
  const totDeptoBs = r.rankingDeptoGasto.reduce((acc, d) => acc + (d.bs || 0), 0);

  const bodyRanking = deptosUnificados.map((d, idx) => [
    String(idx + 1),
    pdfSafe(d.departamento),
    d.cotizaciones > 0 ? `${fmtNum(d.cotizaciones, 0)} cotiz.` : '0 cotiz.',
    fmtUsd(d.usd),
    fmtBs(d.bs),
    `${d.pct.toFixed(1)} %`,
  ]);

  if (!bodyRanking.length) {
    bodyRanking.push(['—', 'Sin datos en el rango seleccionado', '—', '—', '—', '—']);
  }

  const footRanking = deptosUnificados.length
    ? [
        {
          content: 'TOTAL DEPARTAMENTOS',
          colSpan: 2,
          styles: { halign: 'left' as const, fontStyle: 'bold' as const },
        },
        `${fmtNum(totCotizaciones, 0)} cotizaciones`,
        fmtUsd(totDeptoUsd),
        fmtBs(totDeptoBs),
        '100.0 %',
      ]
    : undefined;

  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M, bottom: 24 },
    head: [['#', 'Departamento', 'Cotizaciones', 'Total USD ($)', 'Total Bs (BCV)', '% del Gasto']],
    body: bodyRanking,
    foot: footRanking ? [footRanking as unknown as string[]] : undefined,
    theme: 'grid',
    styles: {
      fontSize: esLandscape ? 8.3 : 7.6, // +15%
      cellPadding: { top: 2.2, bottom: 2.8, left: 3.0, right: 3.0 },
      lineColor: colores.BORDE,
      lineWidth: 0.3,
      textColor: colores.TINTA,
      valign: 'middle',
    },
    headStyles: {
      fillColor: colores.NARANJA,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      halign: 'center',
      cellPadding: { top: 2.4, bottom: 3.0, left: 3.0, right: 3.0 },
      fontSize: esLandscape ? 8.3 : 7.6,
    },
    footStyles: {
      fillColor: [241, 245, 249],
      textColor: colores.TINTA,
      fontStyle: 'bold',
      fontSize: esLandscape ? 8.3 : 7.6,
    },
    alternateRowStyles: {
      fillColor: colores.FONDO_ALT,
    },
    columnStyles: {
      0: { cellWidth: 22, halign: 'center' },
      1: { halign: 'left', fontStyle: 'bold' },
      2: { halign: 'center', cellWidth: esLandscape ? 85 : 75 },
      3: { halign: 'right', fontStyle: 'bold', cellWidth: esLandscape ? 95 : 85 },
      4: { halign: 'right', cellWidth: esLandscape ? 110 : 95 },
      5: { halign: 'right', cellWidth: esLandscape ? 80 : 70 },
    },
    didDrawCell: (data) => {
      if (data.section === 'body' && data.column.index === 5 && deptosUnificados.length > 0) {
        const rawDepto = deptosUnificados[data.row.index];
        const pct = rawDepto?.pct ?? 0;
        if (pct > 0) {
          const barH = 1.8;
          const barY = data.cell.y + data.cell.height - barH - 1.5;
          const barMaxW = data.cell.width - 8;
          const barX = data.cell.x + 4;
          doc.setFillColor(226, 232, 240);
          doc.rect(barX, barY, barMaxW, barH, 'F');
          const fillW = Math.max(1, Math.min(barMaxW, (pct / 100) * barMaxW));
          doc.setFillColor(...colores.NARANJA);
          doc.rect(barX, barY, fillW, barH, 'F');
        }
      }
    },
  });

  const lastTable1 = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
  y = (lastTable1?.finalY ?? y) + 4;

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7.5); // +15%
  doc.setTextColor(...colores.GRIS_TEXTO);
  doc.text(`* ${AVISO_RANKING}`, M + 2, y + 4);
  y += 16;

  // 3. Compras directas por categoría de gasto (si existen)
  if (r.comprasDirectasPorCategoriaGasto.length > 0) {
    if (y + 60 > PAGE_H - M) {
      doc.addPage();
      y = M;
    }
    y = dibujarHeaderSeccion(
      doc,
      `${seccionNum++}. Compras Directas por Categoría de Gasto`,
      `Total acumulado: ${fmtUsd(r.totalDirectasUsd)} · ${fmtBs(r.totalDirectasBs)}`,
      M,
      y,
      colores.NARANJA,
      colores.TINTA,
      colores.GRIS_TEXTO,
    );

    const totDirUsd = r.totalDirectasUsd || 1;
    const bodyDirectas = r.comprasDirectasPorCategoriaGasto.map((c, idx) => {
      const pct = totDirUsd > 0 ? (c.usd / totDirUsd) * 100 : 0;
      return [
        String(idx + 1),
        pdfSafe(c.categoria || 'Sin categoría asignada'),
        fmtUsd(c.usd),
        fmtBs(c.bs),
        `${pct.toFixed(1)} %`,
      ];
    });

    const footDirectas = [
      {
        content: 'TOTAL COMPRAS DIRECTAS',
        colSpan: 2,
        styles: { halign: 'left' as const, fontStyle: 'bold' as const },
      },
      fmtUsd(r.totalDirectasUsd),
      fmtBs(r.totalDirectasBs),
      '100.0 %',
    ];

    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M, bottom: 24 },
      head: [['#', 'Categoría de Gasto', 'Total USD ($)', 'Total Bs (BCV)', '% del Total Directas']],
      body: bodyDirectas,
      foot: [footDirectas as unknown as string[]],
      theme: 'grid',
      styles: {
        fontSize: esLandscape ? 8.3 : 7.6, // +15%
        cellPadding: { top: 2.2, bottom: 2.8, left: 2.8, right: 2.8 },
        lineColor: colores.BORDE,
        lineWidth: 0.3,
        textColor: colores.TINTA,
        valign: 'middle',
      },
      headStyles: {
        fillColor: [51, 65, 85],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        halign: 'center',
        cellPadding: { top: 2.4, bottom: 3.0, left: 2.8, right: 2.8 },
        fontSize: esLandscape ? 8.3 : 7.6,
      },
      footStyles: {
        fillColor: [241, 245, 249],
        textColor: colores.TINTA,
        fontStyle: 'bold',
        fontSize: esLandscape ? 8.3 : 7.6,
      },
      alternateRowStyles: { fillColor: colores.FONDO_ALT },
      columnStyles: {
        0: { cellWidth: 24, halign: 'center' },
        1: { halign: 'left', fontStyle: 'bold' },
        2: { halign: 'right', fontStyle: 'bold', cellWidth: esLandscape ? 95 : 85 },
        3: { halign: 'right', cellWidth: esLandscape ? 110 : 95 },
        4: { halign: 'right', cellWidth: esLandscape ? 85 : 75 },
      },
    });

    const lastTable2 = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
    y = (lastTable2?.finalY ?? y) + 14;
  }

  // 4. Top Categorías e Ítems con mayor inversión (si existen)
  if (r.topCategorias.length > 0 || r.topItems.length > 0) {
    if (y + 60 > PAGE_H - M) {
      doc.addPage();
      y = M;
    }
    y = dibujarHeaderSeccion(
      doc,
      `${seccionNum++}. Top Categorías e Ítems con Mayor Inversión`,
      'Concentración de compras por conceptos e inventario',
      M,
      y,
      colores.NARANJA,
      colores.TINTA,
      colores.GRIS_TEXTO,
    );

    if (r.topCategorias.length > 0) {
      const bodyTopCat = r.topCategorias.map((t, idx) => [
        String(idx + 1),
        pdfSafe(t.nombre),
        fmtUsd(t.usd),
      ]);

      autoTable(doc, {
        startY: y,
        margin: { left: M, right: M, bottom: 24 },
        head: [['#', 'Top Categorías de Inventario', 'Total Invertido USD ($)']],
        body: bodyTopCat,
        theme: 'grid',
        styles: {
          fontSize: esLandscape ? 8.3 : 7.6, // +15%
          cellPadding: { top: 2.2, bottom: 2.8, left: 2.5, right: 2.5 },
          lineColor: colores.BORDE,
          lineWidth: 0.3,
          textColor: colores.TINTA,
          valign: 'middle',
        },
        headStyles: {
          fillColor: [71, 85, 105],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          halign: 'center',
          cellPadding: { top: 2.4, bottom: 3.0, left: 2.5, right: 2.5 },
          fontSize: esLandscape ? 8.3 : 7.6,
        },
        alternateRowStyles: { fillColor: colores.FONDO_ALT },
        columnStyles: {
          0: { cellWidth: 24, halign: 'center' },
          1: { halign: 'left', fontStyle: 'bold' },
          2: { halign: 'right', fontStyle: 'bold', cellWidth: esLandscape ? 120 : 100 },
        },
      });

      const lastTopCat = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
      y = (lastTopCat?.finalY ?? y) + 12;
    }

    if (r.topItems.length > 0) {
      const bodyTopItems = r.topItems.map((t, idx) => [
        String(idx + 1),
        pdfSafe(t.nombre),
        t.cantidad != null ? `${fmtNum(t.cantidad, t.cantidad % 1 === 0 ? 0 : 2)} u.` : '—',
        fmtUsd(t.usd),
      ]);

      autoTable(doc, {
        startY: y,
        margin: { left: M, right: M, bottom: 24 },
        head: [['#', 'Top Ítems Registrados', 'Cantidad', 'Total Invertido USD ($)']],
        body: bodyTopItems,
        theme: 'grid',
        styles: {
          fontSize: esLandscape ? 8.3 : 7.6, // +15%
          cellPadding: { top: 2.2, bottom: 2.8, left: 2.5, right: 2.5 },
          lineColor: colores.BORDE,
          lineWidth: 0.3,
          textColor: colores.TINTA,
          valign: 'middle',
        },
        headStyles: {
          fillColor: [71, 85, 105],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          halign: 'center',
          cellPadding: { top: 2.4, bottom: 3.0, left: 2.5, right: 2.5 },
          fontSize: esLandscape ? 8.3 : 7.6,
        },
        alternateRowStyles: { fillColor: colores.FONDO_ALT },
        columnStyles: {
          0: { cellWidth: 24, halign: 'center' },
          1: { halign: 'left', fontStyle: 'bold' },
          2: { halign: 'right', cellWidth: esLandscape ? 70 : 60 },
          3: { halign: 'right', fontStyle: 'bold', cellWidth: esLandscape ? 100 : 90 },
        },
      });

      const lastTopItems = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
      y = (lastTopItems?.finalY ?? y) + 14;
    }
  }

  return { y, siguienteSeccion: seccionNum };
}

export async function descargarComprasPdf(
  filas: FilaReporteCompras[],
  resumen: ResumenReporteCompras,
  columnasClaves: string[],
  meta: MetadatosExportacionCompras,
): Promise<void> {
  const doc = await construirComprasPdf(filas, resumen, columnasClaves, meta);
  previewPdf(doc, `compras-${meta.ambito}-${hoyStr()}.pdf`);
}

/* ============================================================
   3. CSV
   ============================================================ */

/** Arma el CSV (con BOM) blindado contra «formula injection». Función pura. */
export function construirComprasCsv(
  filas: FilaReporteCompras[],
  columnasClaves: string[],
  meta: MetadatosExportacionCompras,
): string {
  const columnas = columnasVisibles(columnasClaves, meta);
  const escapar = (val: unknown) => {
    let s = String(val ?? '');
    // Anti «CSV formula injection»: si el texto empieza por = + - @ o tab/retorno,
    // se le antepone una comilla simple para que quede como TEXTO (el proveedor,
    // el departamento, el código y el ítem son texto libre que pudo escribir cualquiera).
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return (s.includes(';') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lineas: string[] = [];
  lineas.push(columnas.map((c) => escapar(c.etiqueta)).join(';'));
  for (const f of filas) {
    const vals = columnas.map((c) => {
      if (c.formato === 'moneda' || c.formato === 'numero' || c.formato === 'porcentaje') {
        const n = numeroDeColumna(f, c.clave);
        return n == null ? '' : String(n).replace('.', ','); // coma decimal para Excel en español
      }
      const raw = rawDeColumna(f, c.clave);
      if (raw == null) return '';
      return escapar(c.clave === 'fecha' ? fmtFecha(String(raw)) : raw);
    });
    lineas.push(vals.join(';'));
  }
  return '﻿' + lineas.join('\r\n');
}

export function descargarComprasCsv(
  filas: FilaReporteCompras[],
  columnasClaves: string[],
  meta: MetadatosExportacionCompras,
): void {
  const columnas = columnasVisibles(columnasClaves, meta);
  if (!columnas.length) throw new Error('Selecciona al menos una columna.');
  if (!filas.length) throw new Error('No hay datos para exportar.');
  const csvContent = construirComprasCsv(filas, columnasClaves, meta);
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `compras-${meta.ambito}-${hoyStr()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
