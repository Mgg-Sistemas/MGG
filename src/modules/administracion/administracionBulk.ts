/* ============================================================
   Golden Touch · Administración · carga masiva del histórico (Excel/CSV)
   Lee el archivo (xlsx/xls o CSV/texto), lo analiza con `analizarGrid`
   (válidas / duplicadas / con error, errores por columna, duplicado en archivo
   y contra la base) — el mismo patrón que la carga de Depósito Mina — y aplica
   SOLO las filas válidas. Incluye la plantilla con hoja de instrucciones.
   ============================================================ */
import { previewExcel } from '@/shared/lib/reportePreview';
import {
  analizarGrid, gridDesdeTexto,
  type AnalisisImportAdmin, type ContextoImport, type ExistenteMov,
} from './administracionImport';
import type { AdminRepo } from './admin.repository';

/** Lee un archivo (CSV o Excel) y lo analiza. Lanza con mensaje claro si falla. */
export async function analizarArchivoAdmin(file: File, ctx: ContextoImport, existentes: ExistenteMov[] = []): Promise<AnalisisImportAdmin> {
  const nombre = file.name.toLowerCase();
  const grid = (nombre.endsWith('.xlsx') || nombre.endsWith('.xls'))
    ? await gridDesdeExcel(file)
    : gridDesdeTexto(await file.text());
  return analizarGrid(grid, ctx, existentes);
}

/** Analiza texto pegado (CSV) directamente. */
export function analizarTextoAdmin(texto: string, ctx: ContextoImport, existentes: ExistenteMov[] = []): AnalisisImportAdmin {
  return analizarGrid(gridDesdeTexto(texto), ctx, existentes);
}

async function gridDesdeExcel(file: File): Promise<string[][]> {
  const XLSX = await import('xlsx-js-style');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  // La hoja de datos: «Movimientos» si existe; si no, la primera que no sea «Instrucciones»/«Empresas».
  const sheetName = wb.SheetNames.find((n) => n.toLowerCase() === 'movimientos')
    ?? wb.SheetNames.find((n) => !['instrucciones', 'empresas'].includes(n.toLowerCase()))
    ?? wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  if (!sheet) throw new Error('El archivo no tiene hojas con datos.');
  const utils = (XLSX as unknown as { utils: { sheet_to_json: <T>(ws: unknown, o?: unknown) => T[] } }).utils;
  const filas = utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', blankrows: false });
  return filas.map((r) => (Array.isArray(r) ? r.map((c) => (c == null ? '' : String(c).trim())) : []));
}

/** Importa las filas VÁLIDAS del análisis (las con error nunca entran). */
export async function aplicarImportacionAdmin(repo: AdminRepo, analisis: AnalisisImportAdmin): Promise<{ insertados: number; errores: number }> {
  let insertados = 0;
  let errores = 0;
  for (const f of analisis.filas) {
    if (!f.input) { if (f.estado === 'error') errores += 1; continue; }
    try { await repo.crearMovimiento(f.input); insertados += 1; }
    catch { errores += 1; }
  }
  return { insertados, errores };
}

/* ───────── Plantilla Excel (con instrucciones) ───────── */

const HEADER_STYLE = {
  font: { name: 'Arial', sz: 12, bold: true, color: { rgb: 'FFFFFF' } },
  fill: { patternType: 'solid', fgColor: { rgb: 'FF8A00' } },
  alignment: { vertical: 'center', horizontal: 'left' as const },
};
const INSTR_TITLE = { font: { name: 'Arial', sz: 14, bold: true, color: { rgb: 'FFFFFF' } }, fill: { patternType: 'solid', fgColor: { rgb: 'FF8A00' } }, alignment: { horizontal: 'left' as const, wrapText: true } };
const INSTR_SECTION = { font: { name: 'Arial', sz: 12, bold: true, color: { rgb: '111827' } }, fill: { patternType: 'solid', fgColor: { rgb: 'FFE7CC' } }, alignment: { horizontal: 'left' as const, wrapText: true } };
const INSTR_BODY = { font: { name: 'Arial', sz: 11, color: { rgb: '1f2937' } }, alignment: { horizontal: 'left' as const, wrapText: true } };

const ENCABEZADO = ['empresa', 'fecha', 'concepto', 'monto', 'moneda', 'proveedor', 'periodo', 'categoria', 'estado', 'nota'];

interface XUtils {
  utils: {
    book_new: () => unknown;
    book_append_sheet: (wb: unknown, ws: unknown, name: string) => void;
    aoa_to_sheet: (rows: unknown[][]) => Record<string, unknown>;
    encode_cell: (a: { c: number; r: number }) => string;
    decode_range: (s: string) => { s: { c: number; r: number }; e: { c: number; r: number } };
  };
}

export async function descargarPlantillaAdminExcel(empresas: { clave: string; nombre: string }[] = []): Promise<void> {
  const XLSX = (await import('xlsx-js-style')) as unknown as XUtils;
  const u = XLSX.utils;
  const wb = u.book_new();

  // Hoja Instrucciones.
  const instr: string[][] = [
    ['INSTRUCCIONES · CARGA DEL HISTÓRICO DE GASTOS FIJOS · GOLDEN TOUCH 1127 C.A.'],
    [''],
    ['1. ESTRUCTURA'],
    ['• Trabajá sobre la hoja «Movimientos». No renombres las columnas. Una fila por movimiento; los datos arrancan en la fila 2.'],
    [''],
    ['2. COLUMNAS'],
    ['• empresa (OBLIGATORIA): la clave (p. ej. GT) o la razón social de una empresa registrada. Ver la hoja «Empresas».'],
    ['• fecha (OBLIGATORIA): AAAA-MM-DD (2026-10-05) o dd/mm/aaaa (05/10/2026).'],
    ['• concepto (OBLIGATORIO): qué se pagó (Agua, Alquiler, Honorarios…).'],
    ['• monto (OBLIGATORIO): número ≥ 0. Acepta 1.800,00 o 1800.00. Sin letras.'],
    ['• moneda (OBLIGATORIA): Bs o USD.'],
    ['• proveedor (opcional): beneficiario.'],
    ['• periodo (opcional): 2026-10 | 2026-T4 | 2026-S2 | 2026-B6 | 2026. Vacío = se deriva de la fecha (mensual).'],
    ['• categoria (opcional): debe coincidir con una categoría de gasto existente; si no, queda sin categoría.'],
    ['• estado (opcional): pagado | pendiente | anulado. Vacío = pagado.'],
    ['• nota (opcional): texto libre.'],
    [''],
    ['3. VALIDACIONES'],
    ['❌ Empresa inexistente, fecha inválida, concepto vacío, monto no numérico/negativo, o moneda distinta de Bs/USD → ERROR (esa fila no se importa).'],
    ['⚠ Misma empresa + período + concepto repetida (en el archivo o ya en el sistema) → DUPLICADA (se pide confirmación).'],
    [''],
    ['4. RESULTADO'],
    ['• VALIDADO: todas las filas pasan, carga directa.'],
    ['• DUPLICADOS: se muestran y se pide confirmar.'],
    ['• ERROR: hay filas inválidas; corregilas y volvé a subir. Las filas con error nunca se importan.'],
  ];
  const wsInstr = u.aoa_to_sheet(instr.map((r) => [r[0] ?? ''])) as Record<string, unknown> & { '!cols'?: unknown; '!ref'?: string };
  wsInstr['!cols'] = [{ wch: 110 }];
  const secciones = new Set([2, 5, 17, 21]);
  estilarCol0(XLSX, wsInstr, (r) => (r === 0 ? INSTR_TITLE : secciones.has(r) ? INSTR_SECTION : INSTR_BODY));
  u.book_append_sheet(wb, wsInstr, 'Instrucciones');

  // Hoja Movimientos (solo encabezado).
  const wsMov = u.aoa_to_sheet([ENCABEZADO]) as Record<string, unknown> & { '!cols'?: unknown };
  wsMov['!cols'] = [{ wch: 18 }, { wch: 12 }, { wch: 28 }, { wch: 12 }, { wch: 8 }, { wch: 20 }, { wch: 10 }, { wch: 20 }, { wch: 10 }, { wch: 26 }];
  estilarFila0(XLSX, wsMov as Record<string, unknown> & { '!ref'?: string }, ENCABEZADO.length);
  u.book_append_sheet(wb, wsMov, 'Movimientos');

  // Hoja Empresas (referencia, no se importa).
  const empRows: string[][] = [['clave', 'nombre'], ...empresas.map((e) => [e.clave, e.nombre])];
  const wsEmp = u.aoa_to_sheet(empRows) as Record<string, unknown> & { '!cols'?: unknown; '!ref'?: string };
  wsEmp['!cols'] = [{ wch: 12 }, { wch: 40 }];
  estilarFila0(XLSX, wsEmp, 2);
  u.book_append_sheet(wb, wsEmp, 'Empresas');

  await previewExcel(wb, 'plantilla-gastos-fijos.xlsx');
}

function estilarFila0(XLSX: XUtils, ws: Record<string, unknown> & { '!ref'?: string }, nCols: number) {
  for (let c = 0; c < nCols; c += 1) {
    const cell = ws[XLSX.utils.encode_cell({ r: 0, c })] as { s?: unknown } | undefined;
    if (cell) cell.s = HEADER_STYLE;
  }
}
function estilarCol0(XLSX: XUtils, ws: Record<string, unknown> & { '!ref'?: string }, estilo: (r: number) => unknown) {
  const ref = ws['!ref'];
  if (!ref) return;
  const range = XLSX.utils.decode_range(ref);
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    const cell = ws[XLSX.utils.encode_cell({ r, c: 0 })] as { s?: unknown } | undefined;
    if (cell) cell.s = estilo(r);
  }
}
