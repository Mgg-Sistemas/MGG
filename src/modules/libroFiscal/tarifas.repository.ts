/* ============================================================
   Golden Touch · Retenciones · Tarifas progresivas (R5)

   Una tarifa (p. ej. la Tarifa N° 2 del ISLR) va por versiones desde una
   fecha; cada versión tiene sus tramos (más de «desde» y hasta «hasta»,
   inclusive; el último sin tope) con su % y su sustraendo, en UT o en Bs.
   Una versión se carga, se revisa y se PUBLICA (cerrada): desde ahí sus
   tramos no cambian y se aplica; para cambiarla se hace una versión nueva.
   La base revisa los tramos al publicar (huecos, solapes, primer tramo que no
   empieza en 0, más de uno sin tope) y aplica la tarifa.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { errorRetencion } from './erroresRetencion';
import { tablaDisponible } from './disponibilidad';
import { hoyVenezuela } from '@/shared/lib/rangosFecha';
import { faltaEnClaveMinusculas, faltaNoNegativo, faltaPct } from './parametrosNumeros';

const T_TARIFAS = 'retencion_tarifas';
const T_VERSIONES = 'retencion_tarifa_versiones';
const T_TRAMOS = 'retencion_tarifa_tramos';

export const r5Disponible = () => tablaDisponible(T_TARIFAS);

export type UnidadTarifa = 'UT' | 'Bs';
export const UNIDADES_TARIFA: UnidadTarifa[] = ['UT', 'Bs'];

export interface Tramo { id?: string; desdeMonto: number; hastaMonto: number | null; pct: number; sustraendo: number; nota?: string | null }

export interface VersionTarifa {
  id: string;
  tarifaId: string;
  desde: string;
  hasta: string | null;
  /** Publicada: sus tramos no cambian y se aplica. */
  cerrada: boolean;
  motivo: string;
  fuente: string | null;
  tramos: Tramo[];
}

export interface Tarifa {
  id: string;
  clave: string;
  nombre: string;
  impuestoClave: string | null;
  unidad: UnidadTarifa;
  activo: boolean;
  fuente: string | null;
  nota: string | null;
  versiones: VersionTarifa[];
}

const texto = (v: unknown) => (v == null || String(v).trim() === '' ? null : String(v));
const num = (v: unknown) => (v == null || v === '' ? null : Number(v));
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
/** Hoy en Venezuela (no en UTC: después de las 20:00 ya sería mañana). */
const hoyIso = hoyVenezuela;
const r2 = (v: number) => Math.round(v * 100) / 100;

/* ───────── Piezas puras ───────── */

export function aTramo(r: Record<string, unknown>): Tramo {
  return { id: String(r.id), desdeMonto: num(r.desde_monto) ?? 0, hastaMonto: num(r.hasta_monto), pct: num(r.pct) ?? 0, sustraendo: num(r.sustraendo) ?? 0, nota: texto(r.nota) };
}

export function aVersionTarifa(r: Record<string, unknown>): VersionTarifa {
  const ts = (r.retencion_tarifa_tramos as Record<string, unknown>[] | undefined) ?? [];
  return {
    id: String(r.id), tarifaId: String(r.tarifa_id ?? ''), desde: String(r.desde ?? ''), hasta: texto(r.hasta),
    cerrada: r.cerrada === true, motivo: String(r.motivo ?? ''), fuente: texto(r.fuente),
    tramos: ts.map(aTramo).sort((a, b) => a.desdeMonto - b.desdeMonto),
  };
}

export function aTarifa(r: Record<string, unknown>): Tarifa {
  const vs = (r.retencion_tarifa_versiones as Record<string, unknown>[] | undefined) ?? [];
  return {
    id: String(r.id), clave: String(r.clave ?? ''), nombre: String(r.nombre ?? ''), impuestoClave: texto(r.impuesto_clave),
    unidad: r.unidad === 'Bs' ? 'Bs' : 'UT', activo: r.activo !== false, fuente: texto(r.fuente), nota: texto(r.nota),
    versiones: vs.map(aVersionTarifa).sort((a, b) => b.desde.localeCompare(a.desde)),
  };
}

/** La versión publicada que vale en una fecha (la que aplica la base). */
export function versionAplicable(t: Pick<Tarifa, 'versiones'>, fecha: string = hoyIso()): VersionTarifa | null {
  return t.versiones.filter((v) => v.cerrada && v.desde <= fecha && (!v.hasta || v.hasta >= fecha))
    .sort((a, b) => b.desde.localeCompare(a.desde))[0] ?? null;
}

/** Los problemas de unos tramos, con las mismas reglas que retencion_tarifa_revisar (para verlos antes de guardar). */
export function revisarTramos(tramos: Tramo[]): string[] {
  const xs = [...tramos].sort((a, b) => a.desdeMonto - b.desdeMonto);
  const r: string[] = [];
  if (!xs.length) return ['la versión no tiene tramos'];
  if (xs[0].desdeMonto !== 0) r.push(`el primer tramo empieza en ${xs[0].desdeMonto}, no en 0`);
  xs.forEach((t, i) => {
    const sig = xs[i + 1];
    if (t.hastaMonto != null && t.hastaMonto <= t.desdeMonto) r.push(`el tramo que empieza en ${t.desdeMonto} termina antes de empezar`);
    if (t.pct < 0 || t.pct > 100) r.push(`el tramo que empieza en ${t.desdeMonto} tiene un % fuera de 0 a 100`);
    if (sig && t.hastaMonto == null) r.push(`el tramo que empieza en ${t.desdeMonto} no tiene tope y no es el último`);
    else if (sig && t.hastaMonto !== sig.desdeMonto) r.push(`entre ${t.hastaMonto} y ${sig.desdeMonto} hay un hueco o un solape`);
    if (sig && sig.desdeMonto === t.desdeMonto) r.push(`hay dos tramos que empiezan en ${t.desdeMonto}`);
  });
  if (xs[xs.length - 1].hastaMonto != null) r.push('el último tramo tiene tope: un monto mayor no tendría tasa');
  return r;
}

/**
 * Lo que la base rechaza al GUARDAR un tramo (sus CHECK), o null: «Más de»,
 * «Hasta» y el sustraendo no negativos, «Hasta» mayor que «Más de» y el % de
 * 0 a 100. Huecos y solapes se revisan al publicar (revisarTramos).
 */
export function faltaEnTramos(tramos: Tramo[]): string | null {
  for (const [i, t] of tramos.entries()) {
    const n = i + 1;
    const falta = faltaNoNegativo(t.desdeMonto, `«Más de» del tramo ${n}`)
      ?? faltaNoNegativo(t.hastaMonto, `«Hasta» del tramo ${n}`)
      ?? (t.hastaMonto != null && t.hastaMonto <= t.desdeMonto ? `«Hasta» del tramo ${n} tiene que ser mayor que «Más de» (${t.desdeMonto}).` : null)
      ?? faltaPct(t.pct, `el % del tramo ${n}`)
      ?? faltaNoNegativo(t.sustraendo, `el sustraendo del tramo ${n}`);
    if (falta) return falta;
  }
  return null;
}

export interface TarifaNueva { clave: string; nombre: string; impuestoClave: string | null; unidad: UnidadTarifa; fuente?: string | null; nota?: string | null }

/** Lo que falta en una tarifa nueva, o null. La clave llega ya normalizada (normalizarClave). */
export function faltaEnTarifa(t: Pick<TarifaNueva, 'clave' | 'nombre' | 'unidad'>): string | null {
  return faltaEnClaveMinusculas(t.clave)
    ?? (t.nombre.trim().length < 3 ? 'El nombre de la tarifa necesita al menos 3 letras.' : null)
    ?? (UNIDADES_TARIFA.includes(t.unidad) ? null : 'La unidad de la tarifa es UT o Bs.');
}

export interface Aplicacion { tramo: Tramo; pct: number; sustraendo: number; monto: number }

/** Aplica unos tramos a una base, como retencion_tarifa_aplicar: en UT, la base se lleva a UT y el sustraendo vuelve a Bs. */
export function aplicarTramos(tramos: Tramo[], unidad: UnidadTarifa, base: number, ut: number | null): Aplicacion | null {
  const factor = unidad === 'UT' ? (ut && ut > 0 ? ut : null) : 1;
  if (factor == null || !Number.isFinite(base)) return null;
  const b = base / factor;
  const tramo = [...tramos].sort((a, b2) => b2.desdeMonto - a.desdeMonto).find((t) => t.desdeMonto < b || t.desdeMonto === 0);
  if (!tramo) return null;
  const sustraendo = r2(tramo.sustraendo * factor);
  return { tramo, pct: tramo.pct, sustraendo, monto: Math.max(0, r2((base * tramo.pct) / 100 - tramo.sustraendo * factor)) };
}

/* ───────── Lectura ───────── */

export async function listTarifas(): Promise<Tarifa[]> {
  const { data, error } = await supabase.from(T_TARIFAS).select(`*, ${T_VERSIONES}(*, ${T_TRAMOS}(*))`).order('nombre');
  if (error) throw errorRetencion(error, 'No se pudieron leer las tarifas.');
  return (data ?? []).map((r) => aTarifa(r as Record<string, unknown>));
}

/** Lo que revisa la base de una versión (lista vacía = se puede publicar). */
export async function revisarVersion(versionId: string): Promise<string[]> {
  const { data, error } = await supabase.rpc('retencion_tarifa_revisar', { p_version: versionId });
  if (error) throw errorRetencion(error, 'No se pudo revisar la versión.');
  return (data ?? []) as string[];
}

/** «Probar»: lo que aplica la base para una base, una UT y una fecha. */
export async function probarTarifa(tarifaId: string, base: number, ut: number | null, fecha: string): Promise<{ versionId: string; desdeMonto: number; hastaMonto: number | null; pct: number; sustraendo: number; monto: number } | null> {
  const { data, error } = await supabase.rpc('retencion_tarifa_aplicar', { p_tarifa: tarifaId, p_base: base, p_ut: ut, p_fecha: fecha });
  if (error) throw errorRetencion(error, 'No se pudo aplicar la tarifa.');
  if (!data) return null;
  const d = data as Record<string, unknown>;
  return { versionId: String(d.version_id), desdeMonto: num(d.desde_monto) ?? 0, hastaMonto: num(d.hasta_monto), pct: num(d.pct) ?? 0, sustraendo: num(d.sustraendo) ?? 0, monto: num(d.monto) ?? 0 };
}

/* ───────── Escritura ───────── */

const exigir = (data: unknown, que: string) => {
  const id = (data as { id: string }[] | null)?.[0]?.id;
  if (!id) throw new Error(`No se guardó ${que}: sin permiso de escritura en Retenciones, o ya no existe.`);
  return id;
};

export async function crearTarifa(t: TarifaNueva): Promise<string> {
  const falta = faltaEnTarifa(t);
  if (falta) throw new Error(falta);
  const { data, error } = await supabase.from(T_TARIFAS).insert({
    clave: t.clave, nombre: t.nombre.trim(), impuesto_clave: t.impuestoClave, unidad: t.unidad, fuente: t.fuente?.trim() || null, nota: t.nota?.trim() || null,
  }).select('id');
  if (error) throw errorRetencion(error, 'No se pudo crear la tarifa.', { unico: 'Ya hay una tarifa con esa clave.' });
  return exigir(data, 'la tarifa');
}

/** Versión nueva desde una fecha (sin publicar; la base cierra la anterior el día antes). Puede copiar los tramos de otra. */
export async function nuevaVersionTarifa(tarifaId: string, desde: string, motivo: string, opciones: { fuente?: string | null; copiarTramos?: Tramo[] } = {}): Promise<string> {
  if (!FECHA.test(desde)) throw new Error('Indica desde qué fecha vale la versión.');
  if (!motivo.trim()) throw new Error('Indica el motivo: queda en el historial.');
  const { data, error } = await supabase.from(T_VERSIONES)
    .insert({ tarifa_id: tarifaId, desde, motivo: motivo.trim(), fuente: opciones.fuente?.trim() || null }).select('id');
  if (error) throw errorRetencion(error, 'No se pudo crear la versión.', { unico: 'Esa tarifa ya tiene una versión que empieza en esa fecha.' });
  const id = exigir(data, 'la versión');
  if (opciones.copiarTramos?.length) await guardarTramos(id, opciones.copiarTramos.map(({ id: _id, ...t }) => { void _id; return t; }));
  return id;
}

/**
 * Guarda los tramos de una versión sin publicar: los que tienen id se
 * actualizan y los nuevos se insertan. Para quitar uno, quitarTramo.
 */
export async function guardarTramos(versionId: string, tramos: Tramo[]): Promise<void> {
  const falta = faltaEnTramos(tramos);
  if (falta) throw new Error(falta);
  const fila = (t: Tramo) => ({ desde_monto: t.desdeMonto, hasta_monto: t.hastaMonto, pct: t.pct, sustraendo: t.sustraendo, nota: t.nota?.trim() || null });
  const textos = { unico: 'Hay dos tramos que empiezan en el mismo monto.', regla: 'Revisa los tramos: «hasta» mayor que «desde», % de 0 a 100 y sustraendo no negativo.' };
  for (const t of tramos.filter((x) => x.id)) {
    const { data, error } = await supabase.from(T_TRAMOS).update(fila(t)).eq('id', t.id as string).select('id');
    if (error) throw errorRetencion(error, 'No se pudo guardar un tramo.', textos);
    exigir(data, 'un tramo');
  }
  const nuevos = tramos.filter((x) => !x.id);
  if (nuevos.length) {
    const { data, error } = await supabase.from(T_TRAMOS).insert(nuevos.map((t) => ({ version_id: versionId, ...fila(t) }))).select('id');
    if (error) throw errorRetencion(error, 'No se pudieron guardar los tramos nuevos.', textos);
    if ((data?.length ?? 0) < nuevos.length) throw new Error('No se guardaron los tramos nuevos: sin permiso de escritura en Retenciones.');
  }
}

/** Quita un tramo de una versión sin publicar (BD lo habilita con un DELETE limitado). */
export async function quitarTramo(tramoId: string): Promise<void> {
  const { data, error } = await supabase.from(T_TRAMOS).delete().eq('id', tramoId).select('id');
  if (error) throw errorRetencion(error, 'No se pudo quitar el tramo.');
  exigir(data, 'el cambio (la versión tiene que estar sin publicar)');
}

/** Publica la versión: la base revisa los tramos y, si están bien, la cierra (ya no cambia y se aplica). */
export async function publicarVersion(versionId: string): Promise<void> {
  const { data, error } = await supabase.from(T_VERSIONES).update({ cerrada: true }).eq('id', versionId).select('id');
  if (error) throw errorRetencion(error, 'No se pudo publicar la versión.');
  exigir(data, 'la publicación');
}
