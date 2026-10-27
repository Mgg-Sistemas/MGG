/* ============================================================
   Golden Touch · Control de Maquinaria · Excel de los submódulos
   Mismo formato que los Excel del sistema, SIN logo (09/10/2026): el
   título arranca en la columna A, encabezado naranja, filas cebra.
   ============================================================ */
import { previewExcelArchivo } from '@/shared/lib/reportePreview';
import type { ListadoFlota } from './flotaPdf';

const slug = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').toLowerCase();

/** Excel de un listado. Las columnas de `numeros` (0-based) van alineadas a la derecha con formato numérico. */
export async function listadoFlotaExcel(l: ListadoFlota & { numeros?: number[] }): Promise<void> {
  if (!l.filas.length) throw new Error('No hay filas que exportar con estos filtros.');
  const [{ default: ExcelJS }, { identidadEmpresa }] = await Promise.all([
    import('exceljs'),
    import('@/shared/lib/empresa'),
  ]);
  const emp = identidadEmpresa();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(l.titulo.slice(0, 31), {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ state: 'frozen', ySplit: 4 }],
  });
  const anchos = l.anchos ?? l.encabezados.map(() => 1);
  ws.columns = anchos.map((a) => ({ width: Math.max(10, Math.round(a * 6)) }));
  const ultima = l.encabezados.length;
  const borde = { style: 'thin' as const, color: { argb: 'FFBFC5CC' } };
  const bordes = { top: borde, left: borde, bottom: borde, right: borde };

  // Sin logo: el título arranca en la columna A.
  ws.getRow(1).height = 26; ws.getRow(2).height = 20;
  ws.mergeCells(1, 1, 1, Math.max(1, ultima));
  ws.mergeCells(2, 1, 2, Math.max(1, ultima));
  const t = ws.getCell(1, 1);
  t.value = `${l.titulo} · ${emp.nombre}`;
  t.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFF8A00' } };
  t.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  const sub = ws.getCell(2, 1);
  sub.value = `RIF ${emp.rif} · ${l.subtitulo} · ${l.filas.length} registro(s) · ${new Date().toLocaleString('es-VE')}`;
  sub.font = { name: 'Arial', size: 10, color: { argb: 'FF5C6673' } };
  sub.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };

  const cab = ws.getRow(4);
  cab.values = l.encabezados;
  cab.height = 24;
  cab.eachCell((c) => {
    c.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF8A00' } };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    c.border = bordes;
  });
  l.filas.forEach((f, i) => {
    const r = ws.getRow(5 + i);
    r.values = f.map((c) => (c == null ? '' : c));
    r.eachCell({ includeEmpty: true }, (c, col) => {
      c.font = { name: 'Arial', size: 10 };
      c.border = bordes;
      c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
      if (i % 2 === 1) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAF6F0' } };
      if (l.numeros?.includes(col - 1)) { c.numFmt = '#,##0.##'; c.alignment = { ...c.alignment, horizontal: 'right' }; }
    });
  });
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: ultima } };

  const bytes = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  await previewExcelArchivo(bytes, `${slug(l.archivo)}.xlsx`);
}
