/* ============================================================
   MGG · Control de Maquinaria · Excel de los submódulos
   Mismo formato que los Excel del sistema: título naranja en la columna A,
   encabezado naranja, filas cebra. Se abre en la vista previa (el usuario
   decide si lo descarga).
   ============================================================ */
import { previewExcel } from '@/shared/lib/reportePreview';
import { identidadEmpresa } from '@/shared/lib/empresa';
import type { ListadoFlota } from './flotaPdf';

const slug = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').toLowerCase();

interface AnyXLSX {
  utils: {
    aoa_to_sheet: (d: unknown[][]) => Record<string, unknown>;
    encode_cell: (c: { r: number; c: number }) => string;
    book_new: () => unknown;
    book_append_sheet: (wb: unknown, ws: unknown, name: string) => void;
  };
}

/** Excel de un listado. Las columnas de `numeros` (0-based) van alineadas a la derecha con formato numérico. */
export async function listadoFlotaExcel(l: ListadoFlota & { numeros?: number[] }): Promise<void> {
  if (!l.filas.length) throw new Error('No hay filas que exportar con estos filtros.');
  const XLSX = (await import('xlsx-js-style')) as unknown as AnyXLSX;
  const emp = identidadEmpresa();
  const ultima = l.encabezados.length;
  const aoa: unknown[][] = [
    [`${l.titulo} · ${emp.nombre}`],
    [`RIF ${emp.rif} · ${l.subtitulo} · ${l.filas.length} registro(s) · ${new Date().toLocaleString('es-VE')}`],
    [],
    l.encabezados,
    ...l.filas.map((f) => f.map((c) => (c == null ? '' : c))),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const anchos = l.anchos ?? l.encabezados.map(() => 1);
  (ws as Record<string, unknown>)['!cols'] = anchos.map((a) => ({ wch: Math.max(10, Math.round(a * 6)) }));
  (ws as Record<string, unknown>)['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(0, ultima - 1) } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: Math.max(0, ultima - 1) } },
  ];
  const cellAt = (r: number, c: number) => (ws as Record<string, { s?: unknown; t?: string; z?: string }>)[XLSX.utils.encode_cell({ r, c })];
  const borde = { style: 'thin', color: { rgb: 'BFC5CC' } };
  const bordes = { top: borde, left: borde, bottom: borde, right: borde };
  const titulo = cellAt(0, 0);
  if (titulo) titulo.s = { font: { name: 'Arial', sz: 14, bold: true, color: { rgb: 'FF8A00' } }, alignment: { vertical: 'center', horizontal: 'left' } };
  const sub = cellAt(1, 0);
  if (sub) sub.s = { font: { name: 'Arial', sz: 10, color: { rgb: '5C6673' } }, alignment: { vertical: 'center', horizontal: 'left', wrapText: true } };
  l.encabezados.forEach((_, c) => {
    const cell = cellAt(3, c);
    if (cell) cell.s = {
      font: { name: 'Arial', sz: 11, bold: true, color: { rgb: 'FFFFFF' } },
      fill: { patternType: 'solid', fgColor: { rgb: 'FF8A00' } },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      border: bordes,
    };
  });
  l.filas.forEach((f, i) => {
    f.forEach((_, c) => {
      const cell = cellAt(4 + i, c);
      if (!cell) return;
      const esNumero = l.numeros?.includes(c);
      cell.s = {
        font: { name: 'Arial', sz: 10 },
        border: bordes,
        alignment: { vertical: 'center', horizontal: esNumero ? 'right' : 'left', wrapText: true },
        ...(i % 2 === 1 ? { fill: { patternType: 'solid', fgColor: { rgb: 'FAF6F0' } } } : {}),
      };
      if (esNumero && cell.t === 'n') cell.z = '#,##0.##';
    });
  });
  (ws as Record<string, unknown>)['!autofilter'] = { ref: `A4:${XLSX.utils.encode_cell({ r: 3, c: Math.max(0, ultima - 1) })}` };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, l.titulo.slice(0, 31));
  await previewExcel(wb, `${slug(l.archivo)}.xlsx`);
}
