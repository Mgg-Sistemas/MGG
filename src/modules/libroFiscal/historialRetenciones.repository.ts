/* ============================================================
   Golden Touch · Retenciones · Auditoría = LECTOR del log append-only

   La auditoría del módulo es un LECTOR de una sola fuente: el log
   append-only `retencion_historial`. No reconstruye el estado actual;
   muestra CADA acción tal como quedó registrada (quién, qué, cuándo,
   antes/después, motivo).

   Hoy el log trae los cambios de Parámetros, Impuestos, Reglas, etc. Cuando
   BD aplique el paquete R-LOG, traerá TODAS las acciones del módulo
   (retenciones, buzón, empresas, régimen…). Degradación segura: se muestra
   lo que haya, sin romperse si el log aún es parcial.

   La columna es append-only: aquí SOLO se lee. El «quién anuló» de una
   retención sale del jsonb «después» (anulada_por) cuando R-LOG lo escriba;
   no se cablea aparte, aparece solo en el detalle.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { tablaDisponible } from './disponibilidad';
import { errorRetencion } from './erroresRetencion';

const T_HISTORIAL = 'retencion_historial';

/** ¿Está el log de auditoría en la base? Sin él, la pantalla lo dice y no consulta. */
export function historialDisponible(): Promise<boolean> {
  return tablaDisponible(T_HISTORIAL);
}

/** Qué tipo de acción fue, según lo que trae el log (append-only, sin columna de acción). */
export type AccionHistorial = 'alta' | 'cambio' | 'baja';

/** Tipo de objeto del módulo al que pertenece la fila (para el filtro). */
export type CategoriaHistorial =
  | 'retenciones' | 'impuestos' | 'parametros' | 'regimen' | 'buzon' | 'empresas'
  | 'reglas' | 'clasificaciones' | 'tarifas' | 'supuestos' | 'formatos' | 'periodos' | 'otros';

export interface FilaHistorial {
  id: number;
  tabla: string;
  clave: string | null;
  categoria: CategoriaHistorial;
  categoriaLabel: string;
  accion: AccionHistorial;
  antes: Record<string, unknown> | null;
  despues: Record<string, unknown> | null;
  motivo: string | null;
  actor: string | null;
  at: string;
}

/** Rótulo (en palabras, sin siglas sueltas) de cada categoría. */
export const LABEL_CATEGORIA: Record<CategoriaHistorial, string> = {
  retenciones: 'Retenciones',
  impuestos: 'Impuestos',
  parametros: 'Parámetros (valores)',
  regimen: 'Régimen (quién retiene)',
  buzon: 'Buzón de facturas',
  empresas: 'Empresas',
  reglas: 'Reglas',
  clasificaciones: 'Clasificaciones',
  tarifas: 'Tarifas',
  supuestos: 'Supuestos del IVA',
  formatos: 'Formatos de comprobante',
  periodos: 'Períodos',
  otros: 'Otros',
};

/** A qué categoría pertenece cada tabla del log. Lo que no se reconoce cae en «otros». */
const TABLA_A_CATEGORIA: Record<string, CategoriaHistorial> = {
  retenciones: 'retenciones',
  retencion_documentos: 'retenciones',
  retencion_numeros: 'retenciones',
  retencion_impuestos: 'impuestos',
  retencion_impuesto_versiones: 'impuestos',
  retencion_parametros: 'parametros',
  retencion_parametro_claves: 'parametros',
  retencion_agente_condiciones: 'regimen',
  retencion_facturas_externas: 'buzon',
  retencion_empresas_receptoras: 'empresas',
  retencion_reglas: 'reglas',
  retencion_regla_pasos: 'reglas',
  retencion_regla_condiciones: 'reglas',
  retencion_clasificaciones: 'clasificaciones',
  retencion_clasificacion_codigos: 'clasificaciones',
  retencion_clasificacion_valores: 'clasificaciones',
  retencion_tarifas: 'tarifas',
  retencion_supuestos: 'supuestos',
  retencion_formatos: 'formatos',
  retencion_periodos: 'periodos',
};

/** La categoría (tipo de objeto) de una tabla del log. */
export function categoriaDeTabla(tabla: string): CategoriaHistorial {
  return TABLA_A_CATEGORIA[tabla] ?? 'otros';
}

/** Qué acción fue: sin «antes» es un alta; sin «después», una baja; con ambos, un cambio. */
export function accionDeFila(antes: unknown, despues: unknown): AccionHistorial {
  const hayAntes = antes != null;
  const hayDespues = despues != null;
  if (!hayAntes && hayDespues) return 'alta';
  if (hayAntes && !hayDespues) return 'baja';
  return 'cambio';
}

/** Los campos que cambiaron entre «antes» y «después» (para el detalle). Pura y testeable. */
export interface CampoCambiado { campo: string; antes: unknown; despues: unknown; }
export function diffHistorial(
  antes: Record<string, unknown> | null,
  despues: Record<string, unknown> | null,
): CampoCambiado[] {
  const a = antes ?? {};
  const d = despues ?? {};
  const campos = Array.from(new Set([...Object.keys(a), ...Object.keys(d)])).sort();
  const igual = (x: unknown, y: unknown) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);
  return campos
    .filter((c) => !igual(a[c], d[c]))
    .map((c) => ({ campo: c, antes: a[c] ?? null, despues: d[c] ?? null }));
}

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const texto = (v: unknown): string | null => (v == null || v === '' ? null : String(v));

function mapearFila(r: Record<string, unknown>): FilaHistorial {
  const tabla = String(r.tabla ?? '');
  const categoria = categoriaDeTabla(tabla);
  const antes = obj(r.antes);
  const despues = obj(r.despues);
  return {
    id: Number(r.id),
    tabla,
    clave: texto(r.clave),
    categoria,
    categoriaLabel: LABEL_CATEGORIA[categoria],
    accion: accionDeFila(antes, despues),
    antes,
    despues,
    motivo: texto(r.motivo),
    actor: texto(r.actor),
    at: String(r.at ?? ''),
  };
}

export interface FiltroHistorial {
  /** Solo filas de estas tablas (p. ej. las de una categoría). */
  tablas?: string[];
  desde?: string;
  hasta?: string;
  limite?: number;
}

/**
 * Lee el log, el más nuevo primero. Append-only: solo lectura. El filtro fino
 * (categoría, texto) se hace en pantalla sobre lo leído; aquí solo acotamos por
 * fecha/tablas y el tope, para no traer el log entero.
 */
export async function listHistorial(filtro: FiltroHistorial = {}): Promise<FilaHistorial[]> {
  let q = supabase.from(T_HISTORIAL).select('*').order('at', { ascending: false });
  if (filtro.tablas?.length) q = q.in('tabla', filtro.tablas);
  if (filtro.desde) q = q.gte('at', `${filtro.desde}T00:00:00`);
  if (filtro.hasta) q = q.lte('at', `${filtro.hasta}T23:59:59.999`);
  q = q.limit(filtro.limite ?? 500);
  const { data, error } = await q;
  if (error) throw errorRetencion(error, 'No se pudo leer el log de auditoría.');
  return (data ?? []).map((r) => mapearFila(r as Record<string, unknown>));
}

/**
 * Una celda para CSV: entre comillas y, si el texto empieza por un carácter que
 * Excel/Sheets interpretarían como fórmula (= + - @ o tab/retorno), se le antepone
 * una comilla simple para que quede como TEXTO (anti «CSV formula injection»). El
 * actor/motivo/clave son texto libre que pudo escribir cualquiera, así que se blindan.
 */
export function celdaCsvSegura(valor: string | null | undefined): string {
  const s = String(valor ?? '');
  const seguro = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${seguro.replace(/"/g, '""')}"`;
}

export interface ResumenHistorial { total: number; altas: number; cambios: number; bajas: number; }

/** Conteo por tipo de acción, para las tarjetas. */
export function resumenHistorial(filas: FilaHistorial[]): ResumenHistorial {
  let altas = 0, cambios = 0, bajas = 0;
  for (const f of filas) {
    if (f.accion === 'alta') altas += 1;
    else if (f.accion === 'baja') bajas += 1;
    else cambios += 1;
  }
  return { total: filas.length, altas, cambios, bajas };
}
