/* ============================================================
   MGG · Conciliación · Excel del reporte dinámico (12-11-2026)
   Las mismas columnas y OC que el PDF; se abre en la vista previa de Excel
   (previewExcelArchivo) y se descarga solo si el usuario lo pide.
   ============================================================ */
import { previewExcelArchivo } from '@/shared/lib/reportePreview';
import { COLUMNAS_CONCILIACION, TITULO_CONCILIACION, celda, desgloseTipos, tarjetas, usdTxt, bsTxt, type ColumnaConciliacion, type FilaConciliacion } from './conciliacion';

const NARANJA = 'FFFF8A00';
const BORDE = 'FFCBD5E1';
const CEBRA = 'FFF8FAFC';
const PIE = 'FFF1F5F9';
const FMT_USD = '"$" #,##0.00';
const FMT_BS = '"Bs" #,##0.00';
const FMT_TASA = '#,##0.0000';

const ANCHO: Record<ColumnaConciliacion, number> = {
  item: 7, codigo: 18, tipo: 11, proveedor: 34, monto_usd: 15, monto_bs: 19, tasa: 13,
  moneda_pago: 16, se_cruza: 14,
  referencia: 22, retencion: 28, factura: 14, estado: 18, drive: 16,
};

export interface OpcionesExcelConciliacion {
  columnas: ColumnaConciliacion[];
  filtroTexto?: string;
  conTarjetas?: boolean;
}

/** Valor de la celda: los montos van como número (para poder sumar en Excel). */
function valor(f: FilaConciliacion, c: ColumnaConciliacion): string | number {
  if (c === 'item') return f.item;
  if (c === 'monto_usd') return f.montoUsd;
  if (c === 'monto_bs') return f.montoBs ?? '';
  if (c === 'tasa') return f.tasa ?? '';
  return celda(f, c);
}

export async function construirConciliacionExcel(filas: FilaConciliacion[], op: OpcionesExcelConciliacion): Promise<ArrayBuffer> {
  const cols = COLUMNAS_CONCILIACION.filter((c) => op.columnas.includes(c.clave));
  if (!cols.length) throw new Error('Selecciona al menos una columna.');
  const [{ default: ExcelJS }, { identidadEmpresa }] = await Promise.all([import('exceljs'), import('@/shared/lib/empresa')]);
  const emp = identidadEmpresa('MGG');
  const N = cols.length;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Conciliación', {
    pageSetup: { orientation: N > 6 ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = cols.map((c) => ({ width: ANCHO[c.clave] }));
  const borde = { style: 'thin' as const, color: { argb: BORDE } };
  const bordes = { top: borde, left: borde, bottom: borde, right: borde };

  // ── Membrete ──
  const linea = (texto: string, font: Partial<import('exceljs').Font>, alto?: number) => {
    const r = ws.addRow([texto]);
    ws.mergeCells(r.number, 1, r.number, N);
    r.getCell(1).font = { name: 'Arial', ...font };
    r.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    if (alto) r.height = alto;
  };
  linea(TITULO_CONCILIACION, { size: 14, bold: true, color: { argb: NARANJA } }, 24);
  linea(`${emp.nombre} · RIF ${emp.rif} · ${filas.length} órdenes · Generado: ${new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' })}`,
    { size: 9, color: { argb: 'FF5C6673' } });
  if (op.filtroTexto) linea(op.filtroTexto, { size: 9, italic: true, color: { argb: 'FF5C6673' } });

  // ── Tarjetas de resumen ──
  if (op.conTarjetas !== false) {
    const t = tarjetas(filas);
    ws.addRow([]);
    for (const [tit, val] of [
      ['TOTAL DE ÓRDENES', `${t.totalOc.cantidad} (${desgloseTipos(t)}) · ${usdTxt(t.totalOc.usd)} · ${bsTxt(t.totalOc.bs)}`],
      ['TOTAL PAGADO', `${t.pagado.cantidad} · ${usdTxt(t.pagado.usd)} · ${bsTxt(t.pagado.bs)}`],
      ['CON RETENCIÓN', `${t.conRetencion.cantidad} · ${usdTxt(t.conRetencion.usd)}`],
    ] as const) {
      const r = ws.addRow([`${tit}: ${val}`]);
      ws.mergeCells(r.number, 1, r.number, N);
      r.getCell(1).font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF1E293B' } };
      r.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF4E6' } };
    }
  }
  ws.addRow([]);

  // ── Tabla ──
  const cab = ws.addRow(cols.map((c) => c.label.toUpperCase()));
  cab.height = 22;
  ws.views = [{ state: 'frozen', ySplit: cab.number }];
  cab.eachCell((c) => {
    c.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NARANJA } };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    c.border = bordes;
  });

  const formato = (c: ColumnaConciliacion) => (c === 'monto_usd' ? FMT_USD : c === 'monto_bs' ? FMT_BS : c === 'tasa' ? FMT_TASA : undefined);
  const alinear = (c: ColumnaConciliacion) => (c === 'monto_usd' || c === 'monto_bs' || c === 'tasa' ? 'right' : c === 'proveedor' ? 'left' : 'center');

  filas.forEach((f, i) => {
    const r = ws.addRow(cols.map((c) => valor(f, c.clave)));
    cols.forEach((c, j) => {
      const cell = r.getCell(j + 1);
      cell.font = { name: 'Arial', size: 9.5 };
      cell.border = bordes;
      cell.alignment = { vertical: 'middle', horizontal: alinear(c.clave), wrapText: c.clave === 'proveedor' || c.clave === 'retencion' };
      const nf = formato(c.clave);
      if (nf) cell.numFmt = nf;
      if (i % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CEBRA } };
    });
  });
  if (!filas.length) {
    const r = ws.addRow(['Sin órdenes para los filtros elegidos.']);
    ws.mergeCells(r.number, 1, r.number, N);
    r.getCell(1).font = { name: 'Arial', size: 10, italic: true, color: { argb: 'FF5C6673' } };
    r.getCell(1).alignment = { horizontal: 'center' };
  }

  // ── Totales: «TOTAL» ocupa las columnas antes del primer monto ──
  const primerMonto = cols.findIndex((c) => c.clave === 'monto_usd' || c.clave === 'monto_bs');
  const tot = ws.addRow(cols.map((c) => (c.clave === 'monto_usd' ? filas.reduce((a, f) => a + f.montoUsd, 0)
    : c.clave === 'monto_bs' ? filas.reduce((a, f) => a + (f.montoBs ?? 0), 0) : '')));
  const span = primerMonto > 0 ? primerMonto : primerMonto === 0 ? 0 : N;
  if (span > 0) {
    tot.getCell(1).value = 'TOTAL';
    if (span > 1) ws.mergeCells(tot.number, 1, tot.number, span);
  }
  tot.height = 20;
  cols.forEach((c, j) => {
    const cell = tot.getCell(j + 1);
    cell.font = { name: 'Arial', size: 10, bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PIE } };
    cell.border = bordes;
    cell.alignment = { vertical: 'middle', horizontal: j < span ? 'center' : alinear(c.clave) };
    const nf = formato(c.clave);
    if (nf && j >= span) cell.numFmt = nf;
  });

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

/** Genera el Excel y abre la vista previa (descarga solo si el usuario lo pide). */
export async function vistaPreviaConciliacionExcel(filas: FilaConciliacion[], op: OpcionesExcelConciliacion): Promise<void> {
  const bytes = await construirConciliacionExcel(filas, op);
  await previewExcelArchivo(bytes, `conciliacion-oc-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
