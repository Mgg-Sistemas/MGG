/* ============================================================
   MGG · Conciliación · DRIVE (12-11-2026)

   Se carga un archivo (Excel o CSV) con los pagos —el que se lleva en el Drive /
   el estado de cuenta— con tres datos por fila: código de OC, referencia y monto
   en Bs. Se valida como la importación de Inventario (Validado / Duplicados /
   Error: las filas con error bloquean la carga) y se CRUZA con cada OC:

     · por código de OC → qué orden es;
     · por referencia    → la de Tesorería (últimos dígitos) o la de Conciliación;
     · y el monto en Bs  → lo pagado en Bs (Tesorería) o el monto Bs de la OC.

   Si la referencia Y el monto coinciden: «CUADRA»; si no: «NO CUADRA».
   Lo del archivo queda en el historial de la OC (evento «drive_conciliacion»);
   el estado se calcula en vivo con la referencia y el monto actuales de la OC.
   ============================================================ */
import type { FilaConciliacion } from './conciliacion';

export const EVENTO_DRIVE = 'drive_conciliacion';

export type EstadoDrive = 'CUADRA' | 'NO CUADRA';

/** Lo que trajo el archivo para una OC (lo que se guarda en el historial). */
export interface DatosDrive {
  referencias: string[];
  montoBs: number;
  archivo: string;
  filas: number[];
  at?: string;
  actor?: string;
}

export interface ResultadoDrive {
  estado: EstadoDrive;
  /** Por qué (para el title y la vista previa). */
  motivo: string;
  datos: DatosDrive;
}

/* ───────── Lectura del historial ───────── */
const evsDe = (historial: unknown) => (Array.isArray(historial) ? historial as Array<Record<string, unknown>> : []);

/** Lo último que se cargó del Drive para la OC (o null si nunca se cotejó). */
export function driveDe(historial: unknown): DatosDrive | null {
  const evs = evsDe(historial);
  for (let i = evs.length - 1; i >= 0; i--) {
    const e = evs[i];
    if (e?.evento !== EVENTO_DRIVE) continue;
    const refs = Array.isArray(e.referencias) ? (e.referencias as unknown[]).map((x) => String(x ?? '').trim()).filter(Boolean) : [];
    const monto = Number(e.monto_bs);
    return {
      referencias: refs,
      montoBs: Number.isFinite(monto) ? monto : 0,
      archivo: String(e.archivo ?? ''),
      filas: Array.isArray(e.filas) ? (e.filas as unknown[]).map(Number).filter(Number.isFinite) : [],
      at: typeof e.at === 'string' ? e.at : undefined,
      actor: typeof e.actor === 'string' ? e.actor : undefined,
    };
  }
  return null;
}

/** Lo pagado en Bs según Tesorería (suma de los pagos en Bs del último «pagada»). */
export function pagadoBsTesoreria(historial: unknown): number | null {
  const evs = evsDe(historial);
  for (let i = evs.length - 1; i >= 0; i--) {
    const e = evs[i];
    if (e?.evento !== 'pagada') continue;
    const mp = Array.isArray(e.multipago) ? e.multipago as Array<Record<string, unknown>> : [];
    const bs = mp.filter((p) => /^bs$/i.test(String(p?.moneda ?? '').trim())).reduce((a, p) => a + (Number(p?.monto) || 0), 0);
    return bs > 0 ? Math.round(bs * 100) / 100 : null;
  }
  return null;
}

/* ───────── Normalización ───────── */
const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** «oc-2026-251», «OC 2026 0251», «SV-2026-0012» → «OC-2026-0251». Otro texto: en mayúsculas sin espacios. */
export function normalizarCodigoOc(v: unknown): string {
  const s = sinAcentos(String(v ?? '')).toUpperCase().trim();
  if (!s) return '';
  const m = s.match(/^([A-Z]{2,4})[\s._-]*(\d{4})[\s._-]*(\d{1,6})(?:[\s._-]*(\d{1,3}))?$/);
  if (m) return `${m[1]}-${m[2]}-${m[3].padStart(4, '0')}${m[4] ? `-${m[4]}` : ''}`;
  return s.replace(/\s+/g, '');
}

/** Solo los dígitos / letras de una referencia («Ref. 0012-3456» → «00123456»). */
const limpiaRef = (v: unknown) => sinAcentos(String(v ?? '')).toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * ¿Es la misma referencia? Tesorería guarda los ÚLTIMOS dígitos (…6196) y el banco la
 * completa (000123456196): coinciden si una termina con la otra (al menos 4 caracteres).
 */
export function mismaReferencia(a: unknown, b: unknown): boolean {
  const x = limpiaRef(a), y = limpiaRef(b);
  if (!x || !y) return false;
  const terminaCon = (p: string, q: string) => {
    if (p === q) return true;
    const [corta, larga] = p.length <= q.length ? [p, q] : [q, p];
    return corta.length >= 4 && larga.endsWith(corta);
  };
  if (terminaCon(x, y)) return true;
  // Con solo dígitos, los ceros de la izquierda no cuentan (Excel los borra).
  const sinCeros = (s: string) => (/^\d+$/.test(s) ? s.replace(/^0+/, '') : s);
  return /^\d+$/.test(x) && /^\d+$/.test(y) && terminaCon(sinCeros(x), sinCeros(y));
}

/**
 * Monto en Bs de una celda: número de Excel o texto «Bs 281.103,06», «281103.06», «1.500».
 * Devuelve NaN si no es un número.
 */
export function leerMontoBs(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) / 100 : NaN;
  let s = String(v ?? '').trim();
  if (!s) return NaN;
  if (/[a-z]/i.test(s.replace(/^\s*(bs\.?s?|ves|bs\.?f)\s*/i, ''))) return NaN;
  s = s.replace(/[^\d.,-]/g, '');
  if (!/\d/.test(s)) return NaN;
  const coma = s.lastIndexOf(','), punto = s.lastIndexOf('.');
  if (coma >= 0 && punto >= 0) {
    // El último separador es el decimal.
    s = coma > punto ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (coma >= 0) {
    const dec = s.length - coma - 1;
    s = (s.split(',').length > 2 || dec === 3) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (punto >= 0) {
    const dec = s.length - punto - 1;
    if (s.split('.').length > 2 || dec === 3) s = s.replace(/\./g, ''); // 1.500 = mil quinientos
  }
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

/* ───────── Cruce ───────── */
/** Diferencia aceptada en Bs (redondeos). */
export const TOLERANCIA_BS = 0.05;

const fmtBs = (n: number) => `Bs ${n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Referencias que conoce el sistema para la OC. */
function referenciasSistema(f: Pick<FilaConciliacion, 'referencia'>): string[] {
  return [f.referencia.bs, f.referencia.binance, f.referencia.manual].filter((x): x is string => !!x && !!x.trim());
}

/**
 * CUADRA si alguna referencia del archivo es la de la OC Y el monto en Bs coincide con lo
 * pagado en Bs (Tesorería) o con el monto Bs de la OC.
 */
export function cruzarDrive(
  f: Pick<FilaConciliacion, 'referencia' | 'montoBs'>, datos: DatosDrive, pagadoBs?: number | null,
): ResultadoDrive {
  const refsSis = referenciasSistema(f);
  const refOk = datos.referencias.some((a) => refsSis.some((b) => mismaReferencia(a, b)));
  const esperados = [pagadoBs, f.montoBs].filter((x): x is number => x != null && Number.isFinite(x) && x > 0);
  const montoOk = esperados.some((x) => Math.abs(x - datos.montoBs) <= TOLERANCIA_BS);
  const problemas: string[] = [];
  if (!refsSis.length) problemas.push('la OC no tiene referencia de pago en el sistema');
  else if (!refOk) problemas.push(`referencia distinta (archivo ${datos.referencias.join(', ') || '—'} · sistema ${refsSis.join(', ')})`);
  if (!esperados.length) problemas.push('la OC no tiene monto en Bs en el sistema');
  else if (!montoOk) problemas.push(`monto distinto (archivo ${fmtBs(datos.montoBs)} · sistema ${fmtBs(esperados[0])})`);
  return problemas.length
    ? { estado: 'NO CUADRA', motivo: problemas.join(' · ').replace(/^./, (c) => c.toUpperCase()), datos }
    : { estado: 'CUADRA', motivo: 'La referencia y el monto en Bs coinciden', datos };
}

/* ───────── Lectura y validación del archivo (como Inventario) ───────── */
export type EstadoFilaDrive = 'valido' | 'duplicado' | 'error';

export interface FilaDrive {
  fila: number;
  codigo: string;
  referencia: string;
  montoBs: number;
  errores: string[];
  /** La OC aparece más de una vez en el archivo (sus montos se suman). */
  duplicado: boolean;
  estado: EstadoFilaDrive;
  /** id de la OC en Conciliación (si existe). */
  ordenId: string | null;
}

export interface AnalisisDrive {
  archivo: string;
  total: number;
  validas: number;
  conError: number;
  duplicadas: number;
  errorPorColumna: Record<string, number>;
  filas: FilaDrive[];
  estado: 'Validado' | 'Duplicados' | 'Error';
  /** Por OC: lo que se guardará (las filas repetidas de una OC se juntan). */
  porOrden: Map<string, DatosDrive>;
}

type Columna = 'codigo' | 'referencia' | 'monto';

const ALIAS: Record<Columna, string[]> = {
  codigo: ['codigo oc', 'cod oc', 'oc', 'n oc', 'nro oc', 'no oc', 'numero oc', 'orden', 'orden de compra', 'codigo', 'odc', 'n odc', 'nro odc', 'orden de servicio', 'codigo orden'],
  referencia: ['referencia', 'ref', 'nro referencia', 'n referencia', 'no referencia', 'numero referencia', 'numero de referencia', 'referencia bancaria', 'referencia de pago', 'ref bancaria', 'nro ref', 'n ref'],
  monto: ['monto bs', 'monto en bs', 'monto', 'bs', 'monto bolivares', 'monto en bolivares', 'importe', 'importe bs', 'total bs', 'monto pagado', 'monto pagado bs', 'debe', 'debito', 'cargo'],
};

const normHeader = (v: unknown) => sinAcentos(String(v ?? '')).toLowerCase().replace(/[°º#.:()/_-]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Busca la fila de encabezados (en las primeras 15) y la columna de cada dato. */
export function ubicarColumnas(tabla: unknown[][]): { fila: number; col: Record<Columna, number> } | null {
  for (let r = 0; r < Math.min(tabla.length, 15); r++) {
    const hs = (tabla[r] ?? []).map(normHeader);
    const col = {} as Record<Columna, number>;
    for (const k of Object.keys(ALIAS) as Columna[]) {
      // Primero la coincidencia exacta con el alias más específico; luego «empieza por».
      let i = -1;
      for (const a of ALIAS[k]) { i = hs.indexOf(a); if (i >= 0) break; }
      if (i < 0) for (const a of ALIAS[k]) { i = hs.findIndex((h) => h.startsWith(`${a} `)); if (i >= 0) break; }
      col[k] = i;
    }
    if (col.codigo >= 0 && col.referencia >= 0 && col.monto >= 0 && new Set([col.codigo, col.referencia, col.monto]).size === 3) return { fila: r, col };
  }
  return null;
}

/** Lee la primera hoja del Excel o el CSV como tabla (filas × celdas). */
export async function leerTablaArchivo(file: File): Promise<unknown[][]> {
  const XLSX = await import('xlsx-js-style');
  const X = XLSX as unknown as {
    read: (d: unknown, o: Record<string, unknown>) => { SheetNames: string[]; Sheets: Record<string, unknown> };
    utils: { sheet_to_json: <T>(ws: unknown, o?: unknown) => T[] };
  };
  const esCsv = /\.(csv|txt)$/i.test(file.name) || file.type === 'text/csv';
  // CSV: como texto y SIN interpretar valores (así «1.500» o «000123» no se transforman).
  const wb = esCsv
    ? X.read((await file.text()).replace(/^\uFEFF/, ''), { type: 'string', raw: true })
    : X.read(await file.arrayBuffer(), { type: 'array' });
  const hoja = wb.Sheets[wb.SheetNames[0]];
  if (!hoja) throw new Error('El archivo no tiene hojas con datos.');
  return X.utils.sheet_to_json<unknown[]>(hoja, { header: 1, defval: null, blankrows: false });
}

const EXT_OK = /\.(xlsx|xls|csv)$/i;

/** ¿Sirve el archivo? (Excel o CSV, hasta 10 MB). */
export function errorArchivoDrive(f: { name: string; size: number }): string | null {
  if (!EXT_OK.test(f.name)) return 'El archivo debe ser Excel (.xlsx, .xls) o CSV (.csv).';
  if (f.size > 10 * 1024 * 1024) return 'El archivo no puede superar 10 MB.';
  if (!f.size) return 'El archivo está vacío.';
  return null;
}

/**
 * Valida cada fila (como Inventario): código de OC, referencia y monto obligatorios; la OC
 * tiene que existir en Conciliación; el monto, un número mayor que cero. Una OC repetida en
 * el archivo queda como «duplicada» (se juntan: se suman los montos y valen todas sus referencias).
 */
export function analizarTablaDrive(tabla: unknown[][], archivo: string, ordenes: Array<{ id: string; codigo: string; sp?: string }>): AnalisisDrive {
  const ub = ubicarColumnas(tabla);
  if (!ub) throw new Error('No se encontraron las columnas. El archivo debe tener: «Código OC», «Referencia» y «Monto Bs» (descarga la plantilla).');
  const porCodigo = new Map<string, string>();
  for (const o of ordenes) {
    porCodigo.set(normalizarCodigoOc(o.codigo), o.id);
    if (o.sp && !porCodigo.has(normalizarCodigoOc(o.sp))) porCodigo.set(normalizarCodigoOc(o.sp), o.id);
  }
  const filas: FilaDrive[] = [];
  const errorPorColumna: Record<string, number> = {};
  const sumCol = (c: string) => { errorPorColumna[c] = (errorPorColumna[c] ?? 0) + 1; };
  for (let r = ub.fila + 1; r < tabla.length; r++) {
    const row = tabla[r] ?? [];
    const crudo = { codigo: row[ub.col.codigo], referencia: row[ub.col.referencia], monto: row[ub.col.monto] };
    const vacio = (v: unknown) => v == null || String(v).trim() === '';
    if (vacio(crudo.codigo) && vacio(crudo.referencia) && vacio(crudo.monto)) continue; // fila en blanco
    const codigo = normalizarCodigoOc(crudo.codigo);
    const referencia = String(crudo.referencia ?? '').trim();
    const montoBs = leerMontoBs(crudo.monto);
    const errores: string[] = [];
    if (!codigo) { errores.push('Código de OC vacío'); sumCol('codigo'); }
    else if (!porCodigo.has(codigo)) { errores.push(`La OC ${codigo} no está en Conciliación`); sumCol('codigo'); }
    if (!referencia) { errores.push('Referencia vacía'); sumCol('referencia'); }
    if (vacio(crudo.monto)) { errores.push('Monto vacío'); sumCol('monto'); }
    else if (!Number.isFinite(montoBs)) { errores.push('Monto no es un número'); sumCol('monto'); }
    else if (montoBs <= 0) { errores.push('Monto en cero o negativo'); sumCol('monto'); }
    filas.push({ fila: r + 1, codigo, referencia, montoBs, errores, duplicado: false, estado: errores.length ? 'error' : 'valido', ordenId: porCodigo.get(codigo) ?? null });
  }
  if (!filas.length) throw new Error('El archivo no trae filas con datos debajo de los encabezados.');
  const veces = new Map<string, number>();
  for (const f of filas) if (f.ordenId) veces.set(f.ordenId, (veces.get(f.ordenId) ?? 0) + 1);
  for (const f of filas) if (f.ordenId && (veces.get(f.ordenId) ?? 0) > 1) { f.duplicado = true; if (f.estado === 'valido') f.estado = 'duplicado'; }

  const porOrden = new Map<string, DatosDrive>();
  for (const f of filas) {
    if (f.estado === 'error' || !f.ordenId) continue;
    const d = porOrden.get(f.ordenId) ?? { referencias: [], montoBs: 0, archivo, filas: [] };
    if (!d.referencias.includes(f.referencia)) d.referencias.push(f.referencia);
    d.montoBs = Math.round((d.montoBs + f.montoBs) * 100) / 100;
    d.filas.push(f.fila);
    porOrden.set(f.ordenId, d);
  }
  const conError = filas.filter((f) => f.estado === 'error').length;
  const duplicadas = filas.filter((f) => f.estado === 'duplicado').length;
  return {
    archivo, total: filas.length, validas: filas.filter((f) => f.estado === 'valido').length, conError, duplicadas,
    errorPorColumna, filas, porOrden,
    estado: conError ? 'Error' : duplicadas ? 'Duplicados' : 'Validado',
  };
}

/** Texto de la columna DRIVE (vacío si la OC no se ha cotejado). */
export const textoDrive = (r: ResultadoDrive | null | undefined) => r?.estado ?? '';

/** Plantilla del archivo (Excel con las tres columnas y una fila de ejemplo). */
export async function descargarPlantillaDrive(): Promise<void> {
  const [XLSX, { previewWorkbook }] = await Promise.all([import('xlsx-js-style'), import('@/shared/lib/reportPreview')]);
  const X = XLSX as unknown as {
    utils: { book_new: () => unknown; aoa_to_sheet: (a: unknown[][]) => Record<string, unknown>; book_append_sheet: (wb: unknown, ws: unknown, n: string) => void };
  };
  const wb = X.utils.book_new();
  const ws = X.utils.aoa_to_sheet([['Código OC', 'Referencia', 'Monto Bs'], ['OC-2026-0001', '000012345678', 1500.5]]);
  ws['!cols'] = [{ wch: 16 }, { wch: 22 }, { wch: 16 }];
  X.utils.book_append_sheet(wb, ws, 'Drive');
  previewWorkbook(XLSX, wb, 'plantilla-drive-conciliacion.xlsx');
}
