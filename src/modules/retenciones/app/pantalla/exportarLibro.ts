/* ============================================================
   MGG · Retenciones v8 · Exportar el Libro fiscal (lo filtrado)

   La barra «🖨 Imprimir lista / PDF» de la maqueta (v7BarraImprimirLista),
   con la exportación a CSV y Excel que pidió Master (20/10 12:25). Sale
   exactamente lo que muestra la lista con sus filtros, en el orden de la
   lista. Las anuladas van igual, marcadas: el libro no tiene huecos.
   · CSV: separado por «;», montos con coma decimal (es-VE) y BOM, para que
     Excel lo abra con las tildes y los números bien.
   · Excel: el patrón de Inventario (xlsx-js-style y previewWorkbook), con la
     cabecera naranja del sistema.
   Nada se descarga solo: todo es a pedido, por botón.
   ============================================================ */

import { previewWorkbook } from '@/shared/lib/reportPreview';
import type { RetencionPracticada } from '../datos/puerta';
import { nombreImpuesto } from './pendientesPorDocumento';
import { ESTADO_TEXTO, estadoDe, fechaVe, textoDireccion } from './realizadasYLibro';

export const COLUMNAS_LIBRO = [
  'Fecha', 'Comprobante', 'Impuesto', 'Dirección', 'Proveedor o cliente', 'RIF', 'Factura', 'Documento',
  'Base imponible', 'Impuesto de la factura', '% retenido', 'Retenido', 'Moneda', 'Estado',
] as const;

/** Las columnas numéricas (montos y %). */
const NUMERICAS = new Set([8, 9, 10, 11]);

export interface TablaLibro {
  cabecera: string[];
  cuerpo: (string | number)[][];
  /** Las columnas con montos (por omisión, las del Libro). */
  numericas?: ReadonlySet<number>;
}

const fechaDe = (r: RetencionPracticada) => r.facturaFecha ?? r.createdAt.slice(0, 10);

export function tablaLibro(filas: readonly RetencionPracticada[]): TablaLibro {
  return {
    cabecera: [...COLUMNAS_LIBRO],
    cuerpo: filas.map((r) => [
      fechaVe(fechaDe(r)), r.numeroComprobante ?? '', nombreImpuesto(r.tipo), textoDireccion(r), r.contraparteNombre ?? '', r.contraparteRif ?? '',
      r.facturaNumero ?? '', r.docCodigo ?? '',
      Number(r.baseImponible) || 0, Number(r.impuesto) || 0, Number(r.porcentaje) || 0, Number(r.montoRetenido) || 0,
      r.moneda, ESTADO_TEXTO[estadoDe(r)],
    ]),
  };
}

const celdaCsv = (numericas: ReadonlySet<number>) => (v: string | number, i: number): string => {
  const t = typeof v === 'number' && numericas.has(i)
    ? v.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : String(v);
  return /[";\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

export function textoCsv(t: TablaLibro): string {
  const celda = celdaCsv(t.numericas ?? NUMERICAS);
  const linea = (xs: (string | number)[]) => xs.map(celda).join(';');
  return `\uFEFF${[t.cabecera, ...t.cuerpo].map(linea).join('\r\n')}\r\n`;
}

/** Desde y hasta de lo filtrado (por la fecha de la factura), para el encabezado del PDF. */
export function rangoDeFilas(filas: readonly RetencionPracticada[]): { desde: string; hasta: string } | null {
  if (!filas.length) return null;
  const fs = filas.map(fechaDe).sort();
  return { desde: fs[0], hasta: fs[fs.length - 1] };
}

/** Descarga el CSV (a pedido del usuario). */
export function descargarCsv(t: TablaLibro, nombre: string): void {
  const url = URL.createObjectURL(new Blob([textoCsv(t)], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const CABECERA_XLSX = {
  font: { name: 'Arial', sz: 11, bold: true, color: { rgb: 'FFFFFF' } },
  fill: { patternType: 'solid', fgColor: { rgb: 'FF8A00' } },
  alignment: { horizontal: 'left', vertical: 'center' },
};

/** El Excel, con la vista previa del sistema (previewWorkbook). */
export async function descargarExcel(t: TablaLibro, titulo: string, nombre: string): Promise<void> {
  const XLSX = (await import('xlsx-js-style')) as unknown as {
    utils: {
      aoa_to_sheet: (d: unknown[][]) => Record<string, unknown>;
      encode_cell: (c: { r: number; c: number }) => string;
      book_new: () => unknown;
      book_append_sheet: (wb: unknown, ws: unknown, name: string) => void;
    };
  };
  const ws = XLSX.utils.aoa_to_sheet([[titulo], [], t.cabecera, ...t.cuerpo]);
  const numericas = t.numericas ?? NUMERICAS;
  ws['!cols'] = t.cabecera.map((_, i) => ({ wch: numericas.has(i) ? 14 : i === 4 ? 34 : 16 }));
  const celdas = ws as Record<string, { s?: unknown; z?: string }>;
  t.cabecera.forEach((_, c) => { const x = celdas[XLSX.utils.encode_cell({ r: 2, c })]; if (x) x.s = CABECERA_XLSX; });
  t.cuerpo.forEach((_, i) => numericas.forEach((c) => { const x = celdas[XLSX.utils.encode_cell({ r: i + 3, c })]; if (x) x.z = '#,##0.00'; }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Libro');
  previewWorkbook(XLSX, wb, nombre);
}
