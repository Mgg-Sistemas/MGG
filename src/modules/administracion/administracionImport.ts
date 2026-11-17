/* ============================================================================
   Golden Touch · Administración · importación del histórico (parser puro)
   De un CSV/Excel (o texto pegado) arma movimientos sueltos del histórico, con
   una validación explícita por fila. No confía en el orden: mapea por el nombre
   de la columna del encabezado. Columnas: empresa, fecha, concepto, monto,
   moneda (obligatorias) · proveedor, periodo, categoria, estado, nota (opc).
   Sin React, sin base, determinista. La lectura del archivo (Excel/CSV) y la
   plantilla viven en `administracionBulk.ts`; aquí va la lógica pura del análisis.
   ============================================================================ */
import { tokenPeriodo, type Moneda } from './administracionCalculo';
import type { MovimientoInput, OpcionRef } from './admin.repository';

export interface ContextoImport {
  empresas: { clave: string; nombre: string }[];
  categorias: OpcionRef[];
}
export interface ResultadoImport {
  filas: MovimientoInput[];
  errores: { fila: number; motivo: string }[];
}

export const norm = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export const ALIAS: Record<string, string> = {
  empresa: 'empresa', razon: 'empresa', 'razon social': 'empresa',
  fecha: 'fecha', concepto: 'concepto', servicio: 'concepto', descripcion: 'concepto',
  monto: 'monto', importe: 'monto', total: 'monto', moneda: 'moneda',
  proveedor: 'proveedor', beneficiario: 'proveedor', periodo: 'periodo',
  categoria: 'categoria', estado: 'estado', 'estado de pago': 'estado', estado_pago: 'estado', nota: 'nota',
};
export const COLUMNAS_OBLIGATORIAS = ['empresa', 'fecha', 'concepto', 'monto', 'moneda'] as const;

/** Parte una línea CSV respetando comillas dobles. */
export function partirCsv(linea: string): string[] {
  const out: string[] = [];
  let cur = '';
  let enComillas = false;
  for (let i = 0; i < linea.length; i += 1) {
    const c = linea[i];
    if (c === '"') {
      if (enComillas && linea[i + 1] === '"') { cur += '"'; i += 1; } else enComillas = !enComillas;
    } else if ((c === ',' || c === ';' || c === '\t') && !enComillas) {
      out.push(cur); cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseFecha(v: string): string | null {
  const s = v.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s); // dd/mm/aaaa
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}
export function parseMonto(v: string): number | null {
  if (!/\d/.test(v)) return null; // «abc» no es un monto
  // Acepta 1.800,00 (es) y 1800.00 (en).
  let s = v.replace(/[^\d.,-]/g, '');
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

function parseMoneda(v: string): Moneda | null {
  const m = norm(v);
  if (m === 'bs' || m === 'bolivares') return 'Bs';
  if (m === 'usd' || m === '$' || m === 'dolares') return 'USD';
  return null;
}

interface CtxPreparado {
  empPorClave: Map<string, string>;
  empPorNombre: Map<string, string>;
  catPorNombre: Map<string, string>;
}
function prepararCtx(ctx: ContextoImport): CtxPreparado {
  return {
    empPorClave: new Map(ctx.empresas.map((e) => [norm(e.clave), e.clave])),
    empPorNombre: new Map(ctx.empresas.map((e) => [norm(e.nombre), e.clave])),
    catPorNombre: new Map(ctx.categorias.map((c) => [norm(c.nombre), c.id])),
  };
}

export interface FilaValidada {
  input: MovimientoInput | null;
  errores: string[];
  /** Columnas con error (para el resumen «errores por columna»). */
  cols: string[];
  empresa: string;
  concepto: string;
  monto: string;
}
/** Valida UNA fila (acceso por nombre de columna). Junta TODOS los errores. */
function validarFila(get: (col: string) => string, prep: CtxPreparado): FilaValidada {
  const errores: string[] = [];
  const cols: string[] = [];
  const empRaw = get('empresa');
  const empresaClave = prep.empPorClave.get(norm(empRaw)) ?? prep.empPorNombre.get(norm(empRaw));
  if (!empresaClave) { errores.push(`Empresa «${empRaw}» no existe.`); cols.push('empresa'); }
  const fecha = parseFecha(get('fecha'));
  if (!fecha) { errores.push(`Fecha inválida «${get('fecha')}».`); cols.push('fecha'); }
  const concepto = get('concepto');
  if (!concepto) { errores.push('Concepto vacío.'); cols.push('concepto'); }
  const monto = parseMonto(get('monto'));
  if (monto == null) { errores.push(`Monto inválido «${get('monto')}».`); cols.push('monto'); }
  const moneda = parseMoneda(get('moneda'));
  if (!moneda) { errores.push(`Moneda «${get('moneda')}» (usa Bs o USD).`); cols.push('moneda'); }

  let input: MovimientoInput | null = null;
  if (!errores.length && empresaClave && fecha && moneda && monto != null) {
    const estadoRaw = norm(get('estado'));
    input = {
      empresaClave, gastoFijoId: null, concepto, proveedorNombre: get('proveedor') || null,
      categoriaGastoId: prep.catPorNombre.get(norm(get('categoria'))) ?? null,
      periodo: get('periodo') || tokenPeriodo(fecha, 'mensual'), fecha, monto, moneda, tasaRef: null,
      estadoPago: estadoRaw === 'pendiente' ? 'pendiente' : estadoRaw === 'anulado' ? 'anulado' : 'pagado',
      origen: 'importado', servicioDirectoId: null,
    };
  }
  return { input, errores, cols, empresa: empresaClave ?? empRaw, concepto, monto: get('monto') };
}

/** Mapea los encabezados crudos a las claves canónicas (empresa, fecha, …). */
export function mapearColumnas(encabezados: string[]): string[] {
  return encabezados.map((h) => ALIAS[norm(h)] ?? norm(h));
}

/* ───────── parser CSV simple (compat): {filas, errores} ───────── */
export function parseImportacion(texto: string, ctx: ContextoImport): ResultadoImport {
  const filas: MovimientoInput[] = [];
  const errores: { fila: number; motivo: string }[] = [];
  const lineas = texto.replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '');
  if (lineas.length < 2) return { filas, errores: [{ fila: 0, motivo: 'El archivo no tiene datos (encabezado + al menos una fila).' }] };

  const cols = mapearColumnas(partirCsv(lineas[0]));
  const idx = (nombre: string) => cols.indexOf(nombre);
  for (const req of COLUMNAS_OBLIGATORIAS) {
    if (idx(req) < 0) return { filas, errores: [{ fila: 0, motivo: `Falta la columna obligatoria «${req}».` }] };
  }
  const prep = prepararCtx(ctx);
  for (let i = 1; i < lineas.length; i += 1) {
    const f = partirCsv(lineas[i]);
    const get = (n: string) => (idx(n) >= 0 ? (f[idx(n)] ?? '').trim() : '');
    const r = validarFila(get, prep);
    if (r.input) filas.push(r.input);
    else errores.push({ fila: i + 1, motivo: r.errores[0] ?? 'Fila inválida.' });
  }
  return { filas, errores };
}

/* ───────── Análisis rico (como Depósito Mina): válidas/duplicadas/error ───────── */

export type FilaEstado = 'valido' | 'duplicado' | 'error';
export interface FilaAnalizadaAdmin {
  /** Número de fila en el archivo (1 = encabezado; los datos arrancan en 2). */
  fila: number;
  empresa: string;
  concepto: string;
  monto: string;
  input: MovimientoInput | null;
  errores: string[];
  cols: string[];
  duplicadoEnArchivo: boolean;
  duplicadoEnBd: boolean;
  estado: FilaEstado;
}
export interface AnalisisImportAdmin {
  total: number;
  validas: number;
  conError: number;
  duplicadas: number;
  /** Filas cuyo movimiento ya existe (misma empresa+período+concepto). */
  yaEnBd: number;
  errorPorColumna: Record<string, number>;
  filas: FilaAnalizadaAdmin[];
  estado: 'Validado' | 'Duplicados' | 'Error';
}
/** Movimiento ya existente, para detectar duplicados contra la base. */
export interface ExistenteMov { empresaClave: string; periodo: string; concepto: string; }

const claveMov = (empresaClave: string, periodo: string, concepto: string) =>
  `${norm(empresaClave)}|${norm(periodo)}|${norm(concepto)}`;

/** Analiza una grilla (encabezado + filas de celdas) a un diagnóstico completo.
 *  Lanza si falta una columna obligatoria o no hay datos (lo atrapa el llamador). */
export function analizarGrid(grid: string[][], ctx: ContextoImport, existentes: ExistenteMov[] = []): AnalisisImportAdmin {
  const filasCrudas = grid.filter((r) => r.some((c) => (c ?? '').trim() !== ''));
  if (filasCrudas.length < 2) throw new Error('El archivo no tiene datos (encabezado + al menos una fila).');
  const cols = mapearColumnas(filasCrudas[0]);
  const idx = (nombre: string) => cols.indexOf(nombre);
  for (const req of COLUMNAS_OBLIGATORIAS) {
    if (idx(req) < 0) throw new Error(`Falta la columna obligatoria «${req}».`);
  }
  const prep = prepararCtx(ctx);
  const existSet = new Set(existentes.map((e) => claveMov(e.empresaClave, e.periodo, e.concepto)));

  // Primera pasada: validar cada fila.
  const base = filasCrudas.slice(1).map((f, i) => {
    const get = (n: string) => (idx(n) >= 0 ? (f[idx(n)] ?? '').trim() : '');
    return { fila: i + 2, ...validarFila(get, prep) };
  });

  // Conteo de claves dentro del archivo (solo filas con input válido).
  const cuenta = new Map<string, number>();
  for (const b of base) {
    if (b.input) {
      const k = claveMov(b.input.empresaClave, b.input.periodo, b.input.concepto);
      cuenta.set(k, (cuenta.get(k) ?? 0) + 1);
    }
  }

  const errorPorColumna: Record<string, number> = {};
  const filas: FilaAnalizadaAdmin[] = base.map((b) => {
    for (const c of b.cols) errorPorColumna[c] = (errorPorColumna[c] ?? 0) + 1;
    const k = b.input ? claveMov(b.input.empresaClave, b.input.periodo, b.input.concepto) : '';
    const dupArch = !!b.input && (cuenta.get(k) ?? 0) > 1;
    const dupBd = !!b.input && existSet.has(k);
    const estado: FilaEstado = b.errores.length ? 'error' : (dupArch || dupBd) ? 'duplicado' : 'valido';
    return {
      fila: b.fila, empresa: b.empresa, concepto: b.concepto, monto: b.monto,
      input: b.input, errores: b.errores, cols: b.cols,
      duplicadoEnArchivo: dupArch, duplicadoEnBd: dupBd, estado,
    };
  });

  const validas = filas.filter((f) => f.estado === 'valido').length;
  const conError = filas.filter((f) => f.estado === 'error').length;
  const duplicadas = filas.filter((f) => f.estado === 'duplicado').length;
  const yaEnBd = filas.filter((f) => f.duplicadoEnBd).length;
  const estado: AnalisisImportAdmin['estado'] = conError > 0 ? 'Error' : duplicadas > 0 ? 'Duplicados' : 'Validado';

  return { total: filas.length, validas, conError, duplicadas, yaEnBd, errorPorColumna, filas, estado };
}

/** Grilla a partir de un CSV/texto pegado (para analizarGrid). */
export function gridDesdeTexto(texto: string): string[][] {
  return texto.replace(/\r/g, '').split('\n').map((l) => partirCsv(l));
}
