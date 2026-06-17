/* ============================================================
   MGG · Fundición / Receta · Export a Excel
   Genera un .xlsx con los materiales usados y el resumen de
   costos de una fundición (= receta para X unidades).
   ============================================================ */
import { previewWorkbook } from '@/shared/lib/reportPreview';
import { getProduccionConMateriales } from './produccion.repository';

const BORDER = {
  top:    { style: 'thin', color: { rgb: '000000' } },
  bottom: { style: 'thin', color: { rgb: '000000' } },
  left:   { style: 'thin', color: { rgb: '000000' } },
  right:  { style: 'thin', color: { rgb: '000000' } },
};

// Título principal — naranja con letra blanca (igual que los demás Excel).
const TITLE_STYLE = {
  font: { name: 'Arial', sz: 14, bold: true, color: { rgb: 'FFFFFF' } },
  fill: { patternType: 'solid', fgColor: { rgb: 'FF8A00' } },
  alignment: { horizontal: 'left', vertical: 'center' },
  border: BORDER,
};

// Encabezados de tabla / sección — naranja con letra blanca.
const HEADER_STYLE = {
  font: { name: 'Arial', sz: 12, bold: true, color: { rgb: 'FFFFFF' } },
  fill: { patternType: 'solid', fgColor: { rgb: 'FF8A00' } },
  alignment: { horizontal: 'left', vertical: 'center' },
  border: BORDER,
};

export async function descargarProduccionExcel(id: string): Promise<void> {
  const prod = await getProduccionConMateriales(id);
  if (!prod) throw new Error('Fundición no encontrada');
  const [XLSXmod, { dateTime }] = await Promise.all([
    import('xlsx-js-style'),
    import('@/shared/lib/format'),
  ]);
  const XLSX = XLSXmod as unknown as {
    utils: {
      aoa_to_sheet: (d: unknown[][]) => Record<string, unknown>;
      encode_cell: (c: { r: number; c: number }) => string;
      book_new: () => unknown;
      book_append_sheet: (wb: unknown, ws: unknown, name: string) => void;
    };
    writeFile: (wb: unknown, name: string) => void;
  };

  const cp = prod.costo_material + prod.mano_obra + prod.costos_indirectos;

  const encabezado: (string | number)[][] = [
    ['RECETA / FUNDICIÓN · MGG'],
    ['Producto', prod.producto_nombre],
    ['Cantidad producida (und)', prod.cantidad],
    ['Almacén destino', prod.almacen_destino],
    ['Horno utilizado', prod.horno || '—'],
    ['Receta N°', prod.receta_num != null ? `#${prod.receta_num}` : '—'],
    ['Estado', prod.estado === 'finalizado' ? 'Finalizado' : 'En fundición'],
    ['Inicio', dateTime(prod.inicio_at)],
    ['Fin', prod.fin_at ? dateTime(prod.fin_at) : '—'],
    [],
    ['MATERIALES UTILIZADOS'],
  ];

  const headRow = ['Material', 'Almacén', 'Cantidad', 'Costo unit.', 'Subtotal'];
  const filas = (prod.materiales ?? []).map((m) => [
    m.material_nombre, m.almacen, m.cantidad, m.costo_unitario, m.subtotal,
  ]);

  const resumen: (string | number)[][] = [
    [],
    ['RESUMEN DE COSTOS'],
    ['Costo Total de Materiales (CTM)', prod.costo_material],
    ['Mano de obra', prod.mano_obra],
    ['Costos indirectos', prod.costos_indirectos],
    ['Costo de Fundición (CP)', cp],
    ['Costo unitario (PMP)', prod.costo_unitario],
    ['Precio de venta', prod.precio_venta ?? '—'],
    ['Posible ganancia', prod.ganancia ?? '—'],
  ];

  const aoa = [...encabezado, headRow, ...filas, ...resumen];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 34 }, { wch: 16 }, { wch: 12 }, { wch: 14 }, { wch: 14 }];
  // Combinar el título a lo ancho de la tabla (5 columnas).
  (ws as Record<string, unknown>)['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 4 } }];

  const cellAt = (r: number, c: number) =>
    (ws as Record<string, { s?: unknown }>)[XLSX.utils.encode_cell({ r, c })];
  const styleRow = (r: number, style: unknown, cols = 5) => {
    for (let c = 0; c < cols; c++) {
      const cell = cellAt(r, c);
      if (cell) cell.s = style;
    }
  };

  // Título principal (fila 0) en naranja con letra blanca.
  styleRow(0, TITLE_STYLE);
  // Encabezado de cada sección.
  const seccionMateriales = encabezado.length - 1; // 'MATERIALES UTILIZADOS'
  styleRow(seccionMateriales, HEADER_STYLE);
  // Cabecera de la tabla de materiales.
  const headIdx = encabezado.length;
  styleRow(headIdx, HEADER_STYLE);
  // 'RESUMEN DE COSTOS' (segunda fila del bloque resumen).
  const resumenIdx = encabezado.length + 1 + filas.length + 1;
  styleRow(resumenIdx, HEADER_STYLE);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Receta');
  previewWorkbook(XLSX, wb, `receta-${prod.producto_nombre}-${prod.id.slice(0, 8)}.xlsx`);
}
