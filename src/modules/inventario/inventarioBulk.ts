import { previewWorkbook } from '@/shared/lib/reportPreview';
import { supabase } from '@/shared/lib/supabase';
import type { Producto, RecetaFundicion } from '@/shared/lib/types';
import { RECETAS_FUNDICION } from '@/shared/lib/types';
import { prefijoCategoria } from './inventario.repository';

/* ──────────── Estilos compartidos para los Excel ──────────── */
const HEADER_STYLE = {
  font: { name: 'Arial', sz: 12, bold: true, color: { rgb: 'FFFFFF' } },
  fill: { patternType: 'solid', fgColor: { rgb: 'FF8A00' } },
  alignment: { vertical: 'center', horizontal: 'left' as const },
  border: {
    top:    { style: 'thin', color: { rgb: '000000' } },
    bottom: { style: 'thin', color: { rgb: '000000' } },
    left:   { style: 'thin', color: { rgb: '000000' } },
    right:  { style: 'thin', color: { rgb: '000000' } },
  },
};

const BODY_STYLE = {
  font: { name: 'Arial', sz: 11 },
  alignment: { vertical: 'center' as const, wrapText: true },
};

const INSTR_TITLE_STYLE = {
  font: { name: 'Arial', sz: 14, bold: true, color: { rgb: 'FFFFFF' } },
  fill: { patternType: 'solid', fgColor: { rgb: 'FF8A00' } },
  alignment: { vertical: 'center', horizontal: 'left' as const, wrapText: true },
};

const INSTR_SECTION_STYLE = {
  font: { name: 'Arial', sz: 12, bold: true, color: { rgb: '111827' } },
  fill: { patternType: 'solid', fgColor: { rgb: 'FFE7CC' } },
  alignment: { vertical: 'center', horizontal: 'left' as const, wrapText: true },
};

const INSTR_BODY_STYLE = {
  font: { name: 'Arial', sz: 11, color: { rgb: '1f2937' } },
  alignment: { vertical: 'center' as const, horizontal: 'left' as const, wrapText: true },
};

interface XlsxModule {
  utils: {
    json_to_sheet: (rows: unknown[]) => Record<string, unknown> & { '!ref'?: string };
    book_new: () => unknown;
    book_append_sheet: (wb: unknown, ws: unknown, name: string) => void;
    encode_cell: (a: { c: number; r: number }) => string;
    decode_range: (s: string) => { s: { c: number; r: number }; e: { c: number; r: number } };
    aoa_to_sheet: (rows: unknown[][]) => Record<string, unknown> & { '!ref'?: string; '!merges'?: { s: { r: number; c: number }; e: { r: number; c: number } }[]; '!rows'?: { hpt: number }[] };
  };
  writeFile: (wb: unknown, filename: string) => void;
  read: (data: ArrayBuffer, opts?: unknown) => { SheetNames: string[]; Sheets: Record<string, unknown> };
  // utils extra
}

type WsSheet = Record<string, unknown> & {
  '!ref'?: string;
  '!cols'?: { wch: number }[];
  '!rows'?: { hpt: number }[];
  '!merges'?: { s: { r: number; c: number }; e: { r: number; c: number } }[];
};

function stylize(ws: WsSheet, XLSX: XlsxModule, colWidths?: number[]) {
  const refStr = ws['!ref'];
  if (!refStr) return;
  const range = XLSX.utils.decode_range(refStr);
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr] as { s?: unknown } | undefined;
      if (!cell) continue;
      cell.s = r === 0 ? HEADER_STYLE : BODY_STYLE;
    }
  }
  if (colWidths) ws['!cols'] = colWidths.map((w) => ({ wch: w }));
}

type Row = Record<string, unknown>;

const HEADER_ALIASES: Record<string, string> = {
  sku: 'sku', SKU: 'sku', Sku: 'sku',
  nombre: 'nombre', Nombre: 'nombre', producto: 'nombre', Producto: 'nombre',
  categoria: 'categoria', Categoria: 'categoria', Categoría: 'categoria',
  unidad: 'unidad', Unidad: 'unidad',
  stock: 'stock', Stock: 'stock', existencia: 'stock',
  stock_min: 'stock_min', 'Stock mínimo': 'stock_min', 'Stock minimo': 'stock_min', minimo: 'stock_min',
  precio: 'precio', Precio: 'precio', 'Precio UND': 'precio', 'precio_und': 'precio',
  precio_venta: 'precio_venta', 'Precio venta': 'precio_venta', 'precio venta': 'precio_venta', 'Precio de venta': 'precio_venta',
  almacen: 'almacen', Almacén: 'almacen', Almacen: 'almacen',
  estado: 'estado', Estado: 'estado',
  restock_pct: 'restock_pct', 'Restock %': 'restock_pct', restock: 'restock_pct',
  es_receta: 'es_receta', 'Es receta': 'es_receta', receta: 'es_receta', Receta: 'es_receta',
  es_producible: 'es_producible', 'Es producible': 'es_producible', producible: 'es_producible', Producible: 'es_producible',
};

/** Interpreta SI/NO, true/false, 1/0, x como booleano. */
function toBool(v: unknown): boolean {
  const s = String(v ?? '').trim().toLowerCase();
  return ['si', 'sí', 'true', '1', 'x', 'yes', 'y'].includes(s);
}

function normalize(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    const norm = HEADER_ALIASES[k.trim()] ?? k.trim().toLowerCase();
    out[norm] = v;
  }
  return out;
}

function toStr(v: unknown): string { return v == null ? '' : String(v).trim(); }
function toNum(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : NaN; }
function isLetter(v: unknown): boolean { return typeof v === 'string' && /[A-Za-zÁÉÍÓÚáéíóúÑñÜü]/.test(v); }

/* ──────────── Análisis previo a la importación ──────────── */

export type FilaEstado = 'valido' | 'duplicado' | 'error';

export interface FilaAnalizada {
  fila: number;
  sku: string;
  nombre: string;
  raw: Row;
  errores: string[];
  duplicadoEnArchivo: 'sku' | 'nombre' | 'ambos' | null;
  duplicadoEnBd: 'sku' | 'nombre' | 'ambos' | null;
  estado: FilaEstado;
}

export interface AnalisisImport {
  total: number;
  validas: number;
  conError: number;
  duplicadas: number;
  errorPorColumna: Record<string, number>;
  filas: FilaAnalizada[];
  estado: 'Validado' | 'Duplicados' | 'Error';
}

export async function analizarExcel(file: File): Promise<AnalisisImport> {
  const XLSX = await import('xlsx-js-style');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  // Buscamos la hoja "Productos" si existe; si no, la primera distinta de "Instrucciones".
  const sheetName = wb.SheetNames.find((n) => n.toLowerCase() === 'productos')
    ?? wb.SheetNames.find((n) => n.toLowerCase() !== 'instrucciones')
    ?? wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  if (!sheet) throw new Error('El archivo no tiene hojas con datos.');
  const XLSXany = XLSX as unknown as { utils: { sheet_to_json: <T>(ws: unknown, opts?: unknown) => T[] } };
  const raw = XLSXany.utils.sheet_to_json<Row>(sheet, { defval: null });
  if (!raw.length) throw new Error('La hoja "Productos" está vacía.');

  // Cargar SKUs y nombres existentes para detección de duplicados contra BD.
  const { data: existentes } = await supabase.from('productos').select('sku, nombre, categoria');
  const skuSetBd = new Set<string>((existentes ?? []).map((p) => String(p.sku).toUpperCase()));
  const nombreSetBd = new Set<string>((existentes ?? []).map((p) => String(p.nombre).toUpperCase()));

  // SKU correlativo automático: ya NO se ingresa en la plantilla. Se deriva del
  // prefijo de la CATEGORÍA y se asigna el siguiente número por prefijo (sembrado
  // con el máximo existente + incremental dentro del propio archivo).
  const prodsBd = (existentes ?? []) as Producto[];
  const maxPorPrefijo = new Map<string, number>();
  for (const p of prodsBd) {
    const m = String(p.sku ?? '').match(/^([A-Za-z]+)[-_]?(\d+)$/);
    if (m) { const pre = m[1].toUpperCase(); maxPorPrefijo.set(pre, Math.max(maxPorPrefijo.get(pre) ?? 0, parseInt(m[2], 10))); }
  }
  const genSku = (categoria: string): string => {
    const pre = prefijoCategoria((categoria || 'GENERAL').toUpperCase(), prodsBd).toUpperCase();
    const next = (maxPorPrefijo.get(pre) ?? 0) + 1;
    maxPorPrefijo.set(pre, next);
    return `${pre}-${String(next).padStart(3, '0')}`;
  };

  // Conteo por SKU/nombre dentro del archivo
  const skuCount = new Map<string, number>();
  const nombreCount = new Map<string, number>();
  const previas: Array<{ sku: string; nombre: string }> = [];
  for (const r of raw) {
    const n = normalize(r);
    const sku = toStr(n.sku).toUpperCase();
    const nombre = toStr(n.nombre).toUpperCase();
    if (sku) skuCount.set(sku, (skuCount.get(sku) ?? 0) + 1);
    if (nombre) nombreCount.set(nombre, (nombreCount.get(nombre) ?? 0) + 1);
    previas.push({ sku, nombre });
  }

  const errorPorColumna: Record<string, number> = {};
  const filas: FilaAnalizada[] = [];

  for (let i = 0; i < raw.length; i++) {
    const filaIdx = i + 2; // +1 header, +1 base 1
    const norm = normalize(raw[i]);
    const nombre = toStr(norm.nombre).toUpperCase();
    const errores: string[] = [];

    const sumCol = (col: string) => { errorPorColumna[col] = (errorPorColumna[col] ?? 0) + 1; };

    if (!nombre) { errores.push('Nombre vacío'); sumCol('nombre'); }
    // SKU: si la plantilla no lo trae (lo normal ahora), se genera por categoría.
    // Si por compatibilidad viniera en el archivo, se respeta.
    const sku = nombre
      ? (toStr(norm.sku).toUpperCase() || genSku(toStr(norm.categoria)))
      : toStr(norm.sku).toUpperCase();

    const precio = toNum(norm.precio);
    if (norm.precio != null && norm.precio !== '' && (!Number.isFinite(precio) || isLetter(norm.precio))) {
      errores.push('Precio no es un número'); sumCol('precio');
    } else if (Number.isFinite(precio) && precio < 0) {
      errores.push('Precio negativo'); sumCol('precio');
    }

    const stock = toNum(norm.stock);
    if (norm.stock != null && norm.stock !== '' && (!Number.isFinite(stock) || isLetter(norm.stock))) {
      errores.push('Stock no es un número'); sumCol('stock');
    } else if (Number.isFinite(stock) && stock < 0) {
      errores.push('Stock negativo'); sumCol('stock');
    }

    const stockMin = toNum(norm.stock_min);
    if (norm.stock_min != null && norm.stock_min !== '' && (!Number.isFinite(stockMin) || isLetter(norm.stock_min))) {
      errores.push('Stock mínimo no es un número'); sumCol('stock_min');
    } else if (Number.isFinite(stockMin) && stockMin < 0) {
      errores.push('Stock mínimo negativo'); sumCol('stock_min');
    }

    const estadoRaw = toStr(norm.estado).toLowerCase();
    if (estadoRaw && !['activo', 'inactivo'].includes(estadoRaw)) {
      errores.push('Estado debe ser activo o inactivo'); sumCol('estado');
    }

    // Duplicado en archivo
    let dupArch: FilaAnalizada['duplicadoEnArchivo'] = null;
    const dupSkuArch = sku && (skuCount.get(sku) ?? 0) > 1;
    const dupNomArch = nombre && (nombreCount.get(nombre) ?? 0) > 1;
    if (dupSkuArch && dupNomArch) dupArch = 'ambos';
    else if (dupSkuArch) dupArch = 'sku';
    else if (dupNomArch) dupArch = 'nombre';

    // Duplicado contra BD
    let dupBd: FilaAnalizada['duplicadoEnBd'] = null;
    const dupSkuBd = sku && skuSetBd.has(sku);
    const dupNomBd = nombre && nombreSetBd.has(nombre);
    if (dupSkuBd && dupNomBd) dupBd = 'ambos';
    else if (dupSkuBd) dupBd = 'sku';
    else if (dupNomBd) dupBd = 'nombre';

    const tieneError = errores.length > 0;
    const tieneDup = dupArch !== null || dupBd !== null;
    const estado: FilaEstado = tieneError ? 'error' : tieneDup ? 'duplicado' : 'valido';

    filas.push({
      fila: filaIdx,
      sku,
      nombre,
      raw: norm,
      errores,
      duplicadoEnArchivo: dupArch,
      duplicadoEnBd: dupBd,
      estado,
    });
  }

  const validas = filas.filter((f) => f.estado === 'valido').length;
  const conError = filas.filter((f) => f.estado === 'error').length;
  const duplicadas = filas.filter((f) => f.estado === 'duplicado').length;

  const estadoGeneral: AnalisisImport['estado'] =
    conError > 0 ? 'Error' : duplicadas > 0 ? 'Duplicados' : 'Validado';

  return {
    total: filas.length,
    validas,
    conError,
    duplicadas,
    errorPorColumna,
    filas,
    estado: estadoGeneral,
  };
}

export interface ImportResult {
  insertados: number;
  actualizados: number;
  errores: Array<{ fila: number; sku: string; motivo: string }>;
}

/**
 * Aplica el insert/update sobre productos EN LOTE (un solo upsert por SKU y un
 * solo upsert de existencias), en vez de 3 consultas por fila. Salta filas con
 * error de datos. Esto evita que la importación se "cuelgue" con archivos grandes.
 */
export async function aplicarImportacion(analisis: AnalisisImport): Promise<ImportResult> {
  const result: ImportResult = { insertados: 0, actualizados: 0, errores: [] };

  // 1) Construir los payloads válidos (las filas con error nunca se importan).
  interface Preparada { fila: number; sku: string; almacen: string; stock: number; precio: number; payload: Record<string, unknown>; }
  const preparadas: Preparada[] = [];
  for (const f of analisis.filas) {
    if (f.estado === 'error') {
      result.errores.push({ fila: f.fila, sku: f.sku, motivo: f.errores.join(' · ') });
      continue;
    }
    const r = f.raw;
    const recetaRaw = toStr(r.receta_fundicion).toUpperCase();
    const recetaFund = (RECETAS_FUNDICION as readonly string[]).includes(recetaRaw)
      ? (recetaRaw as RecetaFundicion)
      : null;
    const estadoRaw = toStr(r.estado).toLowerCase();
    const estado = estadoRaw === 'inactivo' ? 'inactivo' : 'activo';

    const stockNum = toNum(r.stock); const stock = Number.isFinite(stockNum) ? stockNum : 0;
    const stockMinNum = toNum(r.stock_min); const stockMin = Number.isFinite(stockMinNum) ? stockMinNum : 0;
    const precioNum = toNum(r.precio); const precio = Number.isFinite(precioNum) ? precioNum : 0;
    const precioVentaNum = toNum(r.precio_venta);
    const precioVenta = Number.isFinite(precioVentaNum) ? precioVentaNum : null;
    const restockNum = toNum(r.restock_pct);
    const restockPct = Number.isFinite(restockNum) ? restockNum : null;
    // No forzar mayúsculas: los nombres de almacén deben respetar la forma
    // canónica de la tabla `almacenes` (ej. "General", "Almacén 1") para que
    // coincidan con las existencias y la vista de fundición.
    const almacen = toStr(r.almacen).trim() || 'General';

    preparadas.push({
      fila: f.fila, sku: f.sku, almacen, stock, precio,
      payload: {
        sku: f.sku,
        nombre: f.nombre,
        categoria: toStr(r.categoria).toUpperCase() || 'GENERAL',
        unidad: toStr(r.unidad) || 'und',
        stock,
        stock_min: stockMin,
        precio,
        precio_venta: precioVenta,
        almacen,
        estado,
        receta_fundicion: recetaFund,
        restock_pct: restockPct,
        es_receta: toBool(r.es_receta),
        es_producible: toBool(r.es_producible),
      },
    });
  }

  if (!preparadas.length) return result;

  // 2) Cuántos ya existen (para contar insertados vs actualizados).
  const skus = preparadas.map((p) => p.sku);
  const yaExisten = new Set<string>();
  for (let i = 0; i < skus.length; i += 500) {
    const lote = skus.slice(i, i + 500);
    const { data } = await supabase.from('productos').select('sku').in('sku', lote);
    (data ?? []).forEach((row) => yaExisten.add(String(row.sku)));
  }

  // 3) Upsert de productos en lote (insert + update en una sola llamada por SKU).
  const { data: upserted, error: upErr } = await supabase
    .from('productos')
    .upsert(preparadas.map((p) => p.payload), { onConflict: 'sku' })
    .select('id, sku');
  if (upErr) {
    // Si el lote falla completo, reportar todas las filas con el motivo.
    preparadas.forEach((p) => result.errores.push({ fila: p.fila, sku: p.sku, motivo: upErr.message }));
    return result;
  }
  const idBySku = new Map<string, string>((upserted ?? []).map((row) => [String(row.sku), row.id as string]));
  for (const p of preparadas) {
    if (yaExisten.has(p.sku)) result.actualizados++; else result.insertados++;
  }

  // 4) Sincronizar existencias por almacén en un solo upsert (modelo multi-almacén).
  const nowIso = new Date().toISOString();
  const exRows = preparadas
    .map((p) => ({ producto_id: idBySku.get(p.sku), almacen: p.almacen, stock: p.stock, costo_promedio: p.precio, updated_at: nowIso }))
    .filter((r): r is { producto_id: string; almacen: string; stock: number; costo_promedio: number; updated_at: string } => !!r.producto_id);
  if (exRows.length) {
    const { error: exErr } = await supabase.from('existencias').upsert(exRows, { onConflict: 'producto_id,almacen' });
    if (exErr) {
      // No invalida la importación de productos; solo se avisa.
      result.errores.push({ fila: 0, sku: '(existencias)', motivo: `Productos importados pero no se pudo sincronizar almacén: ${exErr.message}` });
    }
  }

  return result;
}

/* ──────────── Plantilla con hoja de instrucciones ──────────── */

function buildInstruccionesSheet(XLSX: XlsxModule): WsSheet {
  const rows: (string | null)[][] = [
    ['INSTRUCCIONES DE CARGA · PLANTILLA INVENTARIO MGG'],
    [''],
    ['1. ESTRUCTURA DEL ARCHIVO'],
    ['• Trabajá exclusivamente sobre la hoja "Productos". No renombres columnas.'],
    ['• Una fila por producto. La fila 1 es el encabezado; los datos arrancan en la fila 2.'],
    ['• Podés agregar tantas filas como necesites; el sistema procesa hasta el último renglón con NOMBRE.'],
    ['• NO se ingresa el SKU: lo asigna el sistema automáticamente, correlativo por categoría (ej. VIV-034).'],
    [''],
    ['2. COLUMNAS Y FORMATO'],
    ['• nombre (texto): obligatorio, descripción corta del producto. Se guarda en MAYÚSCULAS.'],
    ['• categoria (texto): define el prefijo del SKU (VÍVERES → VIV-, HERRAMIENTAS → HER-…). Si la dejás vacía se asigna "GENERAL".'],
    ['• unidad (texto): opcional (und, kg, tambor, caja, …). Por defecto "und".'],
    ['• stock (número entero ≥ 0): no acepta letras ni decimales negativos. Vacío = 0.'],
    ['• stock_min (número entero ≥ 0): umbral de reabastecimiento. Vacío = 0.'],
    ['• precio (número ≥ 0): puede tener decimales. No acepta letras ni negativos. (Precio UND).'],
    ['• precio_venta (número ≥ 0): opcional. Posible precio de venta del producto.'],
    ['• almacen (texto): opcional. Por defecto "GENERAL". Define en qué almacén entra el stock.'],
    ['• estado (texto): "activo" o "inactivo". Vacío se interpreta como "activo".'],
    ['• restock_pct (número 0–100): opcional. % de reabastecimiento para las alertas de stock.'],
    ['• es_receta (SI/NO): opcional. Marca el producto como insumo de receta (fundición).'],
    ['• es_producible (SI/NO): opcional. Marca el producto como producible (producto terminado).'],
    [''],
    ['3. VALIDACIONES QUE EL SISTEMA APLICA'],
    ['❌ Precio, stock o stock mínimo en negativo → ERROR (no se importa).'],
    ['❌ Precio, stock o stock mínimo con letras → ERROR (no se importa).'],
    ['❌ Estado distinto de "activo" / "inactivo" → ERROR.'],
    ['❌ Nombre vacío → ERROR.'],
    ['⚠ Nombre repetido dentro del archivo o ya presente en el sistema → DUPLICADO.'],
    [''],
    ['4. RESULTADO DE LA IMPORTACIÓN'],
    ['• VALIDADO: todas las filas pasan, importación directa.'],
    ['• DUPLICADOS: el sistema te muestra qué filas son duplicadas y te pregunta si querés continuar. Los SKU existentes se actualizan; los nuevos se insertan.'],
    ['• ERROR: existen filas con datos inválidos. La importación queda bloqueada hasta corregirlas. Las filas con error nunca se importan, ni siquiera si confirmás.'],
    [''],
    ['5. RECOMENDACIONES'],
    ['• Usá puntos decimales (1234.56), no comas.'],
    ['• Evitá fórmulas en columnas numéricas; pegá valores planos.'],
    ['• Verificá categorías y almacenes con la nomenclatura ya usada en el sistema (mayúsculas).'],
  ];

  const ws = XLSX.utils.aoa_to_sheet(rows.map((r) => [r[0] ?? '']));
  ws['!cols'] = [{ wch: 110 }];

  // Estilos
  const refStr = ws['!ref'];
  if (refStr) {
    const range = XLSX.utils.decode_range(refStr);
    const sectionRows = new Set([2, 7, 22, 30, 36]);
    for (let r = range.s.r; r <= range.e.r; r++) {
      const addr = XLSX.utils.encode_cell({ r, c: 0 });
      const cell = ws[addr] as { s?: unknown } | undefined;
      if (!cell) continue;
      if (r === 0) cell.s = INSTR_TITLE_STYLE;
      else if (sectionRows.has(r)) cell.s = INSTR_SECTION_STYLE;
      else cell.s = INSTR_BODY_STYLE;
    }
  }

  // Altura dinámica: las líneas largas envuelven (wrapText), así que la fila
  // debe crecer según cuántas líneas ocupe su texto. Evita el solapamiento.
  const CHARS_POR_LINEA = 95; // aprox. para wch:110
  ws['!rows'] = rows.map((r, i) => {
    if (i === 0) return { hpt: 28 };
    const text = r[0] ?? '';
    const lineas = Math.max(1, Math.ceil(text.length / CHARS_POR_LINEA));
    return { hpt: 6 + lineas * 15 };
  });

  return ws as WsSheet;
}

export async function descargarPlantillaExcel(): Promise<void> {
  const XLSX = await import('xlsx-js-style');
  const XLSXMod = XLSX as unknown as XlsxModule;

  const wb = XLSXMod.utils.book_new();
  const wsInstr = buildInstruccionesSheet(XLSXMod);
  XLSXMod.utils.book_append_sheet(wb, wsInstr, 'Instrucciones');

  // Hoja "Productos" vacía: solo el encabezado para que el usuario cargue sus filas.
  // SIN columna "sku": el SKU lo asigna el sistema (correlativo por categoría).
  const headers = ['nombre', 'categoria', 'unidad', 'stock', 'stock_min', 'precio', 'precio_venta', 'almacen', 'estado', 'restock_pct', 'es_receta', 'es_producible'];
  const wsProd = XLSXMod.utils.aoa_to_sheet([headers]);
  stylize(wsProd as WsSheet, XLSXMod, [32, 18, 12, 10, 12, 12, 14, 16, 12, 12, 12, 14]);
  XLSXMod.utils.book_append_sheet(wb, wsProd, 'Productos');
  previewWorkbook(XLSXMod, wb, 'plantilla-productos.xlsx');
}

/* ──────────── Export filtrado ──────────── */

export interface ExportFiltros {
  categoria?: string;
  estado?: 'activo' | 'inactivo' | '';
  bajoMinimo?: boolean;
  receta?: '' | 'con_receta' | 'sin_receta' | 'en_proceso' | RecetaFundicion;
  almacen?: string;
  unidad?: string;
  texto?: string;
}

export function filtrarParaExport(productos: Producto[], f: ExportFiltros): Producto[] {
  const q = f.texto?.trim().toLowerCase() ?? '';
  return productos.filter((p) => {
    if (f.categoria && p.categoria !== f.categoria) return false;
    if (f.estado && p.estado !== f.estado) return false;
    if (f.bajoMinimo && (p.stock ?? 0) > (p.stock_min ?? 0)) return false;
    if (f.almacen && p.almacen !== f.almacen) return false;
    if (f.unidad && p.unidad !== f.unidad) return false;
    if (f.receta === 'con_receta' && !p.receta_fundicion) return false;
    if (f.receta === 'sin_receta' && p.receta_fundicion) return false;
    if (f.receta === 'en_proceso' && !p.en_fundicion) return false;
    if ((['RECETA 1', 'RECETA 2', 'RECETA 3'] as string[]).includes(f.receta ?? '') && p.receta_fundicion !== f.receta) return false;
    if (q && !(p.sku.toLowerCase().includes(q) || p.nombre.toLowerCase().includes(q))) return false;
    return true;
  });
}

export async function exportarInventarioExcel(productos: Producto[]): Promise<void> {
  const XLSX = await import('xlsx-js-style');
  const XLSXMod = XLSX as unknown as XlsxModule;
  const rows = productos.map((p) => ({
    SKU: p.sku,
    Nombre: p.nombre,
    Categoría: p.categoria,
    Unidad: p.unidad,
    Almacén: p.almacen,
    Stock: p.stock,
    'Stock mínimo': p.stock_min,
    'Precio UND': p.precio,
    'Precio promedio': p.precio_promedio ?? p.precio,
    'Valor': (p.stock ?? 0) * (p.precio ?? 0),
    Estado: p.estado,
    'Receta fundición': p.receta_fundicion ?? '',
    'En proceso fundición': p.en_fundicion ? 'Sí' : 'No',
    'Bajo mínimo': (p.stock ?? 0) < (p.stock_min ?? 0) ? 'Sí' : 'No',
  }));
  const ws = XLSXMod.utils.json_to_sheet(rows);
  stylize(ws as WsSheet, XLSXMod, [14, 32, 18, 12, 16, 10, 12, 18, 16, 14, 12, 18, 18, 14]);
  const wb = XLSXMod.utils.book_new();
  XLSXMod.utils.book_append_sheet(wb, ws, 'Inventario');
  const stamp = new Date().toISOString().slice(0, 10);
  previewWorkbook(XLSXMod, wb, `inventario-${stamp}.xlsx`);
}

export async function exportarInventarioPdf(productos: Producto[]): Promise<void> {
  const [logoDataUrl, { jsPDF }, { default: autoTable }, { dateTime, money, num }, { loadLogoDataUrl }] = await Promise.all([
    Promise.resolve(null),
    import('jspdf'),
    import('jspdf-autotable'),
    import('@/shared/lib/format'),
    import('@/shared/lib/pdfLogo'),
  ]);
  void logoDataUrl;
  const logo = await loadLogoDataUrl().catch(() => null);

  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  const PAGE_W = doc.internal.pageSize.getWidth();
  const MARGIN = 42.52; // 1,5 cm (margen uniforme en todos los lados)
  let y = MARGIN;

  const LOGO_SIZE = 50;
  const TEXT_X = logo ? MARGIN + LOGO_SIZE + 14 : MARGIN;
  if (logo) { try { doc.addImage(logo, 'JPEG', MARGIN, y, LOGO_SIZE, LOGO_SIZE); } catch { /* opcional */ } }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Inventario · Reporte filtrado', TEXT_X, y + 18);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`MGG · ${productos.length} productos · ${dateTime(new Date().toISOString())}`, TEXT_X, y + 34);
  y += Math.max(LOGO_SIZE, 36) + 8;

  doc.setDrawColor(255, 138, 0);
  doc.setLineWidth(1);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 10;

  autoTable(doc, {
    startY: y,
    head: [['SKU', 'Producto', 'Cat.', 'Unid.', 'Almacén', 'Stock', 'Mín.', 'Precio UND', 'Prom.', 'Valor', 'Receta', 'Fund.']],
    body: productos.map((p) => [
      p.sku,
      p.nombre,
      p.categoria,
      p.unidad,
      p.almacen,
      num(p.stock),
      num(p.stock_min),
      money(p.precio),
      money(p.precio_promedio ?? p.precio),
      money((p.stock ?? 0) * (p.precio ?? 0)),
      p.receta_fundicion ?? '—',
      p.en_fundicion ? 'SÍ' : '—',
    ]),
    theme: 'grid',
    headStyles: { fillColor: [255, 138, 0], textColor: 255, fontSize: 8 },
    styles: { fontSize: 7, cellPadding: 3 },
    columnStyles: {
      5: { halign: 'right' }, 6: { halign: 'right' },
      7: { halign: 'right' }, 8: { halign: 'right' }, 9: { halign: 'right' },
    },
    margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  doc.save(`inventario-${stamp}.pdf`);
}
