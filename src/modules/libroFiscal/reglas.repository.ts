/* ============================================================
   Golden Touch · Retenciones · Reglas (R7): guardar y versionar

   Una regla es de un impuesto, va por versiones y nace «en prueba»: solo en
   prueba se editan sus condiciones y sus pasos. Se activa (vigente) y se
   retira con las funciones de la base, con motivo; para cambiar una vigente
   se hace una versión nueva (copia condiciones y pasos, en prueba). La base
   valida cada condición y cada paso; el cálculo lo hace motorReglas.ts.
   Quitar una condición o un paso solo vale en una regla en prueba (BD lo
   habilita con un DELETE limitado).
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { errorRetencion } from './erroresRetencion';
import { tablaDisponible } from './disponibilidad';
import { validarCondicion, validarPaso, type CondicionRegla, type PasoRegla, type Regla } from './motorReglas';

const T_REGLAS = 'retencion_reglas';
const T_CONDICIONES = 'retencion_regla_condiciones';
const T_PASOS = 'retencion_regla_pasos';

export const r7Disponible = () => tablaDisponible(T_REGLAS);

export interface ReglaGuardada extends Regla {
  id: string;
  motivo: string;
  fuente: string | null;
  /** ids de sus filas, para editar o quitar. */
  idsCondiciones: string[];
  actualizadoPor: string | null;
}

const texto = (v: unknown) => (v == null || String(v).trim() === '' ? null : String(v));
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export function aRegla(r: Record<string, unknown>): ReglaGuardada {
  const cs = ((r.retencion_regla_condiciones as Record<string, unknown>[] | undefined) ?? [])
    .slice().sort((a, b) => String(a.pieza).localeCompare(String(b.pieza)));
  const ps = ((r.retencion_regla_pasos as Record<string, unknown>[] | undefined) ?? [])
    .slice().sort((a, b) => Number(a.paso) - Number(b.paso));
  return {
    id: String(r.id), impuestoClave: String(r.impuesto_clave ?? ''), nombre: String(r.nombre ?? ''),
    version: Number(r.version ?? 1) || 1, estado: (r.estado as Regla['estado']) ?? 'en_prueba',
    desde: String(r.desde ?? ''), hasta: texto(r.hasta), prioridad: Number(r.prioridad ?? 100) || 0,
    motivo: String(r.motivo ?? ''), fuente: texto(r.fuente), actualizadoPor: texto(r.actualizado_por),
    condiciones: cs.map((c) => ({ pieza: c.pieza as CondicionRegla['pieza'], operador: (c.operador as CondicionRegla['operador']) ?? 'es', valor: c.valor })),
    idsCondiciones: cs.map((c) => String(c.id)),
    pasos: ps.map((p) => ({ paso: Number(p.paso), operacion: String(p.operacion), valores: (p.valores as Record<string, unknown>) ?? {} })),
  };
}

/** Las reglas de un impuesto (todas sus versiones), con condiciones y pasos. */
export async function listReglas(impuestoClave: string): Promise<ReglaGuardada[]> {
  if (!(await r7Disponible())) return [];
  const { data, error } = await supabase.from(T_REGLAS).select(`*, ${T_CONDICIONES}(*), ${T_PASOS}(*)`)
    .eq('impuesto_clave', impuestoClave).order('nombre').order('version', { ascending: false });
  if (error) {
    if (error.code === '42P01' || error.code === '42703' || error.code === 'PGRST205' || error.code === 'PGRST200' || /relation .* does not exist|column .* does not exist|could not find the table|relationship .* in the schema cache/i.test(error.message ?? '')) {
      return [];
    }
    throw errorRetencion(error, 'No se pudieron leer las reglas.');
  }
  return (data ?? []).map((r) => aRegla(r as Record<string, unknown>));
}

/** Las vigentes (y, si se pide, las en prueba) de un impuesto en una fecha, como las da la base. */
export async function reglasVigentes(impuestoClave: string, fecha: string, incluirPrueba = false): Promise<ReglaGuardada[]> {
  if (!(await r7Disponible())) return [];
  const { data, error } = await supabase.rpc('retencion_reglas_vigentes', { p_impuesto: impuestoClave, p_fecha: fecha, p_incluir_prueba: incluirPrueba });
  if (error) {
    if (error.code === '42883' || error.code === 'PGRST202' || /could not find the function|function .* does not exist/i.test(error.message ?? '')) {
      return [];
    }
    throw errorRetencion(error, 'No se pudieron leer las reglas vigentes.');
  }
  return ((data ?? []) as { regla: Record<string, unknown>; condiciones: unknown[]; pasos: unknown[] }[])
    .filter((x) => x && typeof x === 'object' && 'regla' in x && x.regla)
    .map((x) => aRegla({ ...x.regla, retencion_regla_condiciones: x.condiciones, retencion_regla_pasos: x.pasos }));
}

/* ───────── Escritura ───────── */

const exigir = (data: unknown, que: string) => {
  const id = (data as { id: string }[] | null)?.[0]?.id;
  if (!id) throw new Error(`No se guardó ${que}: sin permiso de escritura en Retenciones, o ya no existe.`);
  return id;
};

export interface ReglaNueva { impuestoClave: string; nombre: string; desde: string; prioridad?: number; motivo: string; fuente?: string | null }

/** Lo que falta en una regla nueva, o null (lo mismo que se dice debajo del botón «Crear»). */
export function faltaEnReglaNueva(r: Omit<ReglaNueva, 'impuestoClave' | 'fuente'>): string | null {
  if (r.nombre.trim().length < 2) return 'El nombre de la regla necesita al menos 2 letras.';
  if (!FECHA.test(r.desde)) return 'Indica desde qué fecha vale la regla.';
  if (r.prioridad != null && (!Number.isInteger(r.prioridad) || r.prioridad < 0)) return 'La prioridad es un entero desde 0.';
  if (!r.motivo.trim()) return 'Indica el motivo: queda en el historial.';
  return null;
}

/** Lo que falta para activar, retirar o hacer una versión nueva de una regla, o null. */
export function faltaEnEstadoRegla(accion: 'activar' | 'retirar' | 'version', fecha: string, motivo: string): string | null {
  if (accion !== 'activar' && !FECHA.test(fecha)) return accion === 'retirar' ? 'Indica hasta qué fecha vale.' : 'Indica desde qué fecha vale la versión nueva.';
  if (!motivo.trim()) return accion === 'activar' ? 'Indica el motivo de la activación.' : accion === 'retirar' ? 'Indica el motivo del retiro.' : 'Indica el motivo.';
  return null;
}

export async function crearRegla(r: ReglaNueva): Promise<string> {
  const falta = faltaEnReglaNueva(r);
  if (falta) throw new Error(falta);
  const { data, error } = await supabase.from(T_REGLAS).insert({
    impuesto_clave: r.impuestoClave, nombre: r.nombre.trim(), desde: r.desde, prioridad: r.prioridad ?? 100,
    motivo: r.motivo.trim(), fuente: r.fuente?.trim() || null,
  }).select('id');
  if (error) throw errorRetencion(error, 'No se pudo crear la regla.', { unico: 'Ya hay una regla con ese nombre y versión en el impuesto.' });
  return exigir(data, 'la regla');
}

/** Cambia los datos de una regla en prueba (fecha, prioridad, motivo, fuente). */
export async function editarRegla(id: string, cambios: { desde?: string; prioridad?: number; motivo?: string; fuente?: string | null }): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (cambios.desde !== undefined) { if (!FECHA.test(cambios.desde)) throw new Error('La fecha no es válida.'); patch.desde = cambios.desde; }
  if (cambios.prioridad !== undefined) {
    if (!Number.isInteger(cambios.prioridad) || cambios.prioridad < 0) throw new Error('La prioridad es un entero desde 0.');
    patch.prioridad = cambios.prioridad;
  }
  if (cambios.motivo !== undefined) { if (!cambios.motivo.trim()) throw new Error('Indica el motivo.'); patch.motivo = cambios.motivo.trim(); }
  if (cambios.fuente !== undefined) patch.fuente = cambios.fuente?.trim() || null;
  const { data, error } = await supabase.from(T_REGLAS).update(patch).eq('id', id).select('id');
  if (error) throw errorRetencion(error, 'No se pudo guardar la regla.');
  exigir(data, 'la regla');
}

/** Agrega una condición (o la cambia, con su id). Se valida antes con las mismas reglas que la base. */
export async function guardarCondicion(reglaId: string, c: CondicionRegla, id?: string): Promise<string> {
  const falta = validarCondicion(c);
  if (falta) throw new Error(`Condición: ${falta}.`);
  const fila = { pieza: c.pieza, operador: c.operador, valor: c.valor };
  const q = id ? supabase.from(T_CONDICIONES).update(fila).eq('id', id) : supabase.from(T_CONDICIONES).insert({ regla_id: reglaId, ...fila });
  const { data, error } = await q.select('id');
  if (error) throw errorRetencion(error, 'No se pudo guardar la condición.');
  return exigir(data, 'la condición');
}

/** Pone (o reemplaza) el paso N de una regla en prueba. */
export async function guardarPaso(reglaId: string, p: PasoRegla): Promise<string> {
  const falta = validarPaso(p);
  if (falta) throw new Error(`Paso ${p.paso}: ${falta}.`);
  const { data, error } = await supabase.from(T_PASOS)
    .upsert({ regla_id: reglaId, paso: p.paso, operacion: p.operacion, valores: p.valores }, { onConflict: 'regla_id,paso' }).select('id');
  if (error) throw errorRetencion(error, 'No se pudo guardar el paso.');
  return exigir(data, 'el paso');
}

/** Quita una condición de una regla en prueba. */
export async function quitarCondicion(id: string): Promise<void> {
  const { data, error } = await supabase.from(T_CONDICIONES).delete().eq('id', id).select('id');
  if (error) throw errorRetencion(error, 'No se pudo quitar la condición.');
  exigir(data, 'el cambio (la regla tiene que estar en prueba)');
}

/** Quita el paso N de una regla en prueba. */
export async function quitarPaso(reglaId: string, paso: number): Promise<void> {
  const { data, error } = await supabase.from(T_PASOS).delete().eq('regla_id', reglaId).eq('paso', paso).select('id');
  if (error) throw errorRetencion(error, 'No se pudo quitar el paso.');
  exigir(data, 'el cambio (la regla tiene que estar en prueba)');
}

/** Versión nueva (en prueba) desde una fecha, con las condiciones y los pasos de esta. Devuelve su id. */
export async function nuevaVersionRegla(id: string, desde: string, motivo: string): Promise<string> {
  if (!FECHA.test(desde)) throw new Error('Indica desde qué fecha vale la versión nueva.');
  if (!motivo.trim()) throw new Error('Indica el motivo.');
  const { data, error } = await supabase.rpc('retencion_regla_nueva_version', { p_regla: id, p_desde: desde, p_motivo: motivo.trim() });
  if (error) throw errorRetencion(error, 'No se pudo crear la versión nueva.');
  if (!data) throw new Error('La base no devolvió la versión nueva.');
  return String(data);
}

/** Activa una regla en prueba (la vigente anterior del mismo nombre cierra el día antes). */
export async function activarRegla(id: string, motivo: string): Promise<void> {
  if (!motivo.trim()) throw new Error('Indica el motivo de la activación.');
  const { error } = await supabase.rpc('retencion_regla_activar', { p_regla: id, p_motivo: motivo.trim() });
  if (error) throw errorRetencion(error, 'No se pudo activar la regla.');
}

/** Retira una regla vigente desde una fecha. */
export async function retirarRegla(id: string, hasta: string, motivo: string): Promise<void> {
  if (!FECHA.test(hasta)) throw new Error('Indica hasta qué fecha vale.');
  if (!motivo.trim()) throw new Error('Indica el motivo del retiro.');
  const { error } = await supabase.rpc('retencion_regla_retirar', { p_regla: id, p_hasta: hasta, p_motivo: motivo.trim() });
  if (error) throw errorRetencion(error, 'No se pudo retirar la regla.');
}
