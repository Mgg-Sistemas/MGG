/* ============================================================
   Golden Touch · Administración · Excel del reporte de gastos fijos
   Mismo estándar que los demás reportes: `xlsx-js-style` + vista previa
   (`previewExcel`). Dos hojas: «Resumen» (por categoría y por empresa) y
   «Detalle» (los movimientos). Los montos van como NÚMEROS (se pueden sumar).
   ============================================================ */
import type { WorkSheet } from 'xlsx-js-style';
import { previewExcel } from '@/shared/lib/reportePreview';
import { nombreArchivoReporteAdmin, estadoPagoLabel, origenLabel, ETIQUETA_DIMENSION, type ReporteAdminData } from './administracionReporte';

type Celda = string | number;

/** Pone en negrita (con fondo gris) una fila 0-based de una hoja ya armada. */
function negrita(XLSX: typeof import('xlsx-js-style'), ws: WorkSheet, fila: number, nCols: number) {
  for (let c = 0; c < nCols; c += 1) {
    const cell = ws[XLSX.utils.encode_cell({ r: fila, c })];
    if (cell && typeof cell === 'object') {
      (cell as { s?: unknown }).s = { font: { bold: true }, fill: { fgColor: { rgb: 'EEEEEE' } } };
    }
  }
}

export async function descargarReporteAdminExcel(data: ReporteAdminData): Promise<void> {
  const XLSX = await import('xlsx-js-style');
  const { meta, total, grupos, agruparPor, filas } = data;
  const dim = ETIQUETA_DIMENSION[agruparPor];

  // ── Hoja Resumen (por la dimensión elegida) ──
  const resumen: Celda[][] = [
    [`Reporte de gastos · ${meta.empresaNombre || 'Todas las empresas'}`],
    [meta.alcanceLabel],
    [`Tasa Bs/USD: ${meta.tasa}`, `Generado: ${new Date(meta.generadoEn).toLocaleString('es-VE')}`],
    [],
    [dim, 'Bs', 'USD', 'Equiv. $', 'Mov.'],
  ];
  const filaDimHead = resumen.length - 1;
  for (const g of grupos) resumen.push([g.clave, g.bs, g.usd, g.equivUsd, g.n]);
  resumen.push(['TOTAL', total.bs, total.usd, total.equivUsd, total.n]);
  const filaTotal = resumen.length - 1;

  const wsR = XLSX.utils.aoa_to_sheet(resumen);
  wsR['!cols'] = [{ wch: 30 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 8 }];
  negrita(XLSX, wsR, 0, 1);
  negrita(XLSX, wsR, filaDimHead, 5);
  negrita(XLSX, wsR, filaTotal, 5);

  // ── Hoja Detalle ──
  const det: Celda[][] = [['Fecha', 'Empresa', 'Concepto', 'Categoría', 'Proveedor', 'Monto', 'Moneda', 'Período', 'Estado', 'Origen']];
  for (const f of filas) det.push([f.fecha, f.empresa, f.concepto, f.categoria, f.proveedor, f.monto, f.moneda, f.periodo, estadoPagoLabel(f.estadoPago), origenLabel(f.origen)]);
  const wsD = XLSX.utils.aoa_to_sheet(det);
  wsD['!cols'] = [{ wch: 12 }, { wch: 24 }, { wch: 28 }, { wch: 22 }, { wch: 20 }, { wch: 12 }, { wch: 8 }, { wch: 10 }, { wch: 11 }, { wch: 11 }];
  negrita(XLSX, wsD, 0, 10);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsR, 'Resumen');
  XLSX.utils.book_append_sheet(wb, wsD, 'Detalle');

  await previewExcel(wb, nombreArchivoReporteAdmin(meta.alcanceLabel, 'xlsx'));
}
