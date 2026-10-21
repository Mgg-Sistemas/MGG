/* ============================================================
   MGG · Compras · Cierre diario (Excel) · 21-10-2026
   Una hoja con lo mismo que la pantalla: título, período, fecha y hora de impresión,
   los cuatro títulos con su cantidad y la tabla de actividad por analista
   (cotizaciones cargadas y órdenes finalizadas). Cantidades como NÚMEROS.
   Estilos del sistema. Se MUESTRA en vista previa: nada se descarga solo.
   ============================================================ */
import { previewWorkbook } from '@/shared/lib/reportPreview';
import { ENCABEZADO, SUBTITULO, TITULO, rgb, type Celda, type XlsxLike } from './reporteComprasExcel';
import { COLOR_TOTAL, COLOR_TOTAL_TEXTO } from './comprasReporte';
import { fechaReporteTexto } from './comprasReporteMensaje';
import type { ResumenCierre } from './cierreDiario';

async function construirLibro(r: ResumenCierre, impresoIso: string): Promise<{ XLSX: XlsxLike; wb: unknown; nombre: string }> {
  const XLSX = (await import('xlsx-js-style')) as unknown as XlsxLike;

  const aoa: unknown[][] = [
    ['CIERRE DIARIO · COMPRAS · MGG'],
    [`Período: ${r.rango.etiqueta}`],
    [`Impreso: ${fechaReporteTexto(impresoIso)}`],
    [],
    ['CONCEPTO', 'CANTIDAD'],
    ...r.items.map((i) => [`${i.emoji} ${i.titulo}`, i.cantidad]),
  ];

  let filaSeccionAnalistas = -1;
  let filaEncabezadoAnalistas = -1;
  let filaInicioAnalistas = -1;
  let filaTotalAnalistas = -1;

  if (r.analistas && r.analistas.length > 0) {
    aoa.push([]);
    filaSeccionAnalistas = aoa.length;
    aoa.push(['ACTIVIDAD POR ANALISTA']);
    filaEncabezadoAnalistas = aoa.length;
    aoa.push(['ANALISTA', 'COTIZACIONES CARGADAS', 'ÓRDENES FINALIZADAS']);
    filaInicioAnalistas = aoa.length;
    r.analistas.forEach((a) => {
      aoa.push([a.nombre, a.cotizaciones, a.ordenesFinalizadas]);
    });
    filaTotalAnalistas = aoa.length;
    aoa.push(['TOTAL', r.totalCotizaciones ?? 0, r.totalFinalizadas ?? 0]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const w = ws as Record<string, unknown>;
  const cell = (row: number, col: number) => (ws as Record<string, Celda>)[XLSX.utils.encode_cell({ r: row, c: col })];

  w['!cols'] = [{ wch: 48 }, { wch: 26 }, { wch: 26 }];
  w['!rows'] = Array.from({ length: aoa.length }, (_, idx) => {
    if (idx === 0) return { hpt: 28 };
    if (idx === 1 || idx === 2) return { hpt: 20 };
    if (idx === 4 || idx === filaEncabezadoAnalistas) return { hpt: 26 };
    if (idx === filaSeccionAnalistas) return { hpt: 24 };
    if (idx === filaTotalAnalistas) return { hpt: 24 };
    return { hpt: 22 };
  });

  const merges = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 2 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 2 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 2 } },
  ];
  if (filaSeccionAnalistas >= 0) {
    merges.push({ s: { r: filaSeccionAnalistas, c: 0 }, e: { r: filaSeccionAnalistas, c: 2 } });
  }
  w['!merges'] = merges;

  const t = cell(0, 0); if (t) t.s = TITULO;
  for (const row of [1, 2]) { const c = cell(row, 0); if (c) c.s = SUBTITULO; }
  for (const col of [0, 1]) { const c = cell(4, col); if (c) c.s = ENCABEZADO; }

  // Estilos de la primera tabla (conceptos generales)
  const filaCuerpo = { font: { name: 'Arial', sz: 11 }, fill: { patternType: 'solid', fgColor: { rgb: rgb(COLOR_TOTAL) } } };
  for (let row = 5; row < 5 + r.items.length; row++) {
    const c0 = cell(row, 0); if (c0) c0.s = { ...filaCuerpo, font: { name: 'Arial', sz: 11, color: { rgb: rgb(COLOR_TOTAL_TEXTO) } } };
    const c1 = cell(row, 1);
    if (c1) { c1.z = '0'; c1.s = { ...filaCuerpo, font: { name: 'Arial', sz: 12, bold: true, color: { rgb: rgb(COLOR_TOTAL_TEXTO) } }, alignment: { horizontal: 'right' } }; }
  }

  // Estilos de la tabla de analistas
  if (filaSeccionAnalistas >= 0) {
    const sCell = cell(filaSeccionAnalistas, 0);
    if (sCell) sCell.s = { font: { name: 'Arial', sz: 12, bold: true, color: { rgb: 'FF8A00' } } };

    for (let col = 0; col <= 2; col++) {
      const hCell = cell(filaEncabezadoAnalistas, col);
      if (hCell) hCell.s = ENCABEZADO;
    }

    const celdaAnalista = { font: { name: 'Arial', sz: 10 } };
    for (let row = filaInicioAnalistas; row < filaTotalAnalistas; row++) {
      const c0 = cell(row, 0); if (c0) c0.s = { ...celdaAnalista, font: { name: 'Arial', sz: 10, bold: true } };
      const c1 = cell(row, 1); if (c1) { c1.z = '0'; c1.s = { ...celdaAnalista, alignment: { horizontal: 'right' } }; }
      const c2 = cell(row, 2); if (c2) { c2.z = '0'; c2.s = { ...celdaAnalista, alignment: { horizontal: 'right' } }; }
    }

    // Fila total analistas
    for (let col = 0; col <= 2; col++) {
      const totCell = cell(filaTotalAnalistas, col);
      if (totCell) {
        totCell.s = {
          font: { name: 'Arial', sz: 11, bold: true, color: { rgb: rgb(COLOR_TOTAL_TEXTO) } },
          fill: { patternType: 'solid', fgColor: { rgb: rgb(COLOR_TOTAL) } },
          alignment: col === 0 ? { horizontal: 'left' } : { horizontal: 'right' },
        };
        if (col > 0) totCell.z = '0';
      }
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Cierre diario');
  return { XLSX, wb, nombre: 'cierre-diario-compras.xlsx' };
}

/** 📊 Muestra el Excel en vista previa (con su botón de descarga). */
export async function exportarCierreDiarioExcel(r: ResumenCierre, impresoIso: string = new Date().toISOString()): Promise<void> {
  const { XLSX, wb, nombre } = await construirLibro(r, impresoIso);
  previewWorkbook(XLSX, wb, nombre);
}
