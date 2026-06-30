/* ============================================================
   MGG · RECEPCIONES (paso intermedio acopio → inventario)
   Al cerrar la caja de un centro/aliado de acopio, el SALDO EN KG de
   casiterita NO entra directo al inventario: se crea una RECEPCIÓN
   (peso + procedencia). El laboratorio carga aparte sus análisis
   (RECEPCIÓN GLOBAL LABORATORIO) por mineral configurable.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/* ───────────── Recepciones (tabla de arriba) ───────────── */
export interface Recepcion {
  id: string;
  item: number;
  fecha: string;
  peso_kg: number;
  procedencia: string;
  centro_nombre?: string | null;
  origen: 'cierre_caja' | 'cierre_aliado' | 'manual';
  ref_caja_id?: string | null;
  ref_aliado_id?: string | null;
  nota?: string | null;
  actor?: string | null;
  actor_name?: string | null;
  created_at: string;
  updated_at?: string | null;
}

export async function listRecepciones(): Promise<Recepcion[]> {
  const { data, error } = await supabase.from('recepciones').select('*').order('item', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Recepcion[];
}

/** Siguiente Item (correlativo): mayor item + 1, arranca en 1. */
export async function nextItemRecepcion(): Promise<number> {
  const { data } = await supabase.from('recepciones').select('item').order('item', { ascending: false }).limit(1).maybeSingle();
  return (num((data as { item?: number } | null)?.item) || 0) + 1;
}

export interface RecepcionInput {
  item?: number | null;
  fecha?: string | null;
  peso_kg: number;
  procedencia: string;
  centro_nombre?: string | null;
  origen?: Recepcion['origen'];
  ref_caja_id?: string | null;
  ref_aliado_id?: string | null;
  nota?: string | null;
}

export async function crearRecepcion(input: RecepcionInput, actor: string, actorName?: string | null): Promise<Recepcion> {
  const item = input.item != null && Number(input.item) > 0 ? Math.floor(Number(input.item)) : await nextItemRecepcion();
  const row = {
    item,
    fecha: input.fecha || new Date().toISOString(),
    peso_kg: num(input.peso_kg),
    procedencia: (input.procedencia || '').trim().toUpperCase(),
    centro_nombre: input.centro_nombre?.trim() || null,
    origen: input.origen ?? 'manual',
    ref_caja_id: input.ref_caja_id ?? null,
    ref_aliado_id: input.ref_aliado_id ?? null,
    nota: input.nota?.trim() || null,
    actor, actor_name: actorName ?? null,
  };
  const { data, error } = await supabase.from('recepciones').insert(row).select('*').single();
  if (error) throw error;
  return data as Recepcion;
}

export async function actualizarRecepcion(id: string, patch: Partial<RecepcionInput>): Promise<void> {
  const p: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.item !== undefined) p.item = Math.floor(Number(patch.item) || 0);
  if (patch.fecha !== undefined) p.fecha = patch.fecha;
  if (patch.peso_kg !== undefined) p.peso_kg = num(patch.peso_kg);
  if (patch.procedencia !== undefined) p.procedencia = (patch.procedencia || '').trim().toUpperCase();
  if (patch.centro_nombre !== undefined) p.centro_nombre = patch.centro_nombre?.trim() || null;
  if (patch.nota !== undefined) p.nota = patch.nota?.trim() || null;
  const { error } = await supabase.from('recepciones').update(p).eq('id', id);
  if (error) throw error;
}

export async function eliminarRecepcion(id: string): Promise<void> {
  const { error } = await supabase.from('recepciones').delete().eq('id', id);
  if (error) throw error;
}

/* ───────────── Minerales (columnas del laboratorio, configurables) ───────────── */
export interface RecepcionMineral {
  id: string;
  clave: string;
  nombre: string;
  subtitulo?: string | null;
  modo: 'abc' | 'prom';   // abc = A/B/C/Prom · prom = solo Prom (ej. UCV)
  color?: string | null;
  orden: number;
  activo: boolean;
  created_at: string;
}

export async function listMinerales(soloActivos = true): Promise<RecepcionMineral[]> {
  let q = supabase.from('recepcion_minerales').select('*').order('orden', { ascending: true });
  if (soloActivos) q = q.eq('activo', true);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as RecepcionMineral[];
}

export async function crearMineral(input: { nombre: string; subtitulo?: string | null; modo: 'abc' | 'prom'; color?: string | null }): Promise<RecepcionMineral> {
  const nombre = input.nombre.trim();
  if (!nombre) throw new Error('Indicá el nombre del mineral.');
  // clave estable a partir del nombre (única).
  const base = nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'mineral';
  const { data: ex } = await supabase.from('recepcion_minerales').select('clave, orden');
  const claves = new Set((ex ?? []).map((m) => String((m as { clave: string }).clave)));
  let clave = base; let i = 2;
  while (claves.has(clave)) clave = `${base}_${i++}`;
  const orden = ((ex ?? []).reduce((mx, m) => Math.max(mx, num((m as { orden: number }).orden)), 0)) + 1;
  const { data, error } = await supabase.from('recepcion_minerales')
    .insert({ clave, nombre, subtitulo: input.subtitulo?.trim() || null, modo: input.modo, color: input.color || null, orden })
    .select('*').single();
  if (error) throw error;
  return data as RecepcionMineral;
}

export async function actualizarMineral(id: string, patch: { nombre?: string; subtitulo?: string | null; modo?: 'abc' | 'prom'; color?: string | null; orden?: number; activo?: boolean }): Promise<void> {
  const p: Record<string, unknown> = {};
  if (patch.nombre !== undefined) { const n = patch.nombre.trim(); if (!n) throw new Error('El nombre no puede estar vacío.'); p.nombre = n; }
  if (patch.subtitulo !== undefined) p.subtitulo = patch.subtitulo?.trim() || null;
  if (patch.modo !== undefined) p.modo = patch.modo;
  if (patch.color !== undefined) p.color = patch.color || null;
  if (patch.orden !== undefined) p.orden = Math.floor(Number(patch.orden) || 0);
  if (patch.activo !== undefined) p.activo = patch.activo;
  const { error } = await supabase.from('recepcion_minerales').update(p).eq('id', id);
  if (error) throw error;
}

/** Desactiva (o reactiva) un mineral: no se borra para no perder el histórico de análisis. */
export async function setMineralActivo(id: string, activo: boolean): Promise<void> {
  const { error } = await supabase.from('recepcion_minerales').update({ activo }).eq('id', id);
  if (error) throw error;
}

/* ───────────── Análisis de laboratorio (tabla de abajo) ───────────── */
/** Valores por mineral: { a, b, c } (modo abc) o { prom } (modo prom). */
export type ValorMineral = { a?: number | null; b?: number | null; c?: number | null; prom?: number | null };
export interface RecepcionAnalisis {
  id: string;
  n_analisis: number;
  fecha: string;
  valores: Record<string, ValorMineral>;
  nota?: string | null;
  actor?: string | null;
  actor_name?: string | null;
  created_at: string;
  updated_at?: string | null;
}

export async function listAnalisis(): Promise<RecepcionAnalisis[]> {
  const { data, error } = await supabase.from('recepcion_analisis').select('*').order('n_analisis', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...(r as RecepcionAnalisis), valores: ((r as RecepcionAnalisis).valores ?? {}) }));
}

export async function nextNAnalisis(): Promise<number> {
  const { data } = await supabase.from('recepcion_analisis').select('n_analisis').order('n_analisis', { ascending: false }).limit(1).maybeSingle();
  return (num((data as { n_analisis?: number } | null)?.n_analisis) || 0) + 1;
}

export async function crearAnalisis(input: { n_analisis?: number | null; fecha?: string | null; valores?: Record<string, ValorMineral>; nota?: string | null }, actor: string, actorName?: string | null): Promise<RecepcionAnalisis> {
  const n = input.n_analisis != null && Number(input.n_analisis) > 0 ? Math.floor(Number(input.n_analisis)) : await nextNAnalisis();
  const { data, error } = await supabase.from('recepcion_analisis')
    .insert({ n_analisis: n, fecha: input.fecha || new Date().toISOString(), valores: input.valores ?? {}, nota: input.nota?.trim() || null, actor, actor_name: actorName ?? null })
    .select('*').single();
  if (error) throw error;
  return data as RecepcionAnalisis;
}

export async function actualizarAnalisis(id: string, patch: { n_analisis?: number; fecha?: string; valores?: Record<string, ValorMineral>; nota?: string | null }): Promise<void> {
  const p: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.n_analisis !== undefined) p.n_analisis = Math.floor(Number(patch.n_analisis) || 0);
  if (patch.fecha !== undefined) p.fecha = patch.fecha;
  if (patch.valores !== undefined) p.valores = patch.valores;
  if (patch.nota !== undefined) p.nota = patch.nota?.trim() || null;
  const { error } = await supabase.from('recepcion_analisis').update(p).eq('id', id);
  if (error) throw error;
}

export async function eliminarAnalisis(id: string): Promise<void> {
  const { error } = await supabase.from('recepcion_analisis').delete().eq('id', id);
  if (error) throw error;
}

/* ───────────── Cálculos ───────────── */
/** Promedio de un mineral en una fila: (a+b+c)/3 (abc) o el valor prom (prom).
 *  Solo cuenta los valores presentes; si no hay ninguno devuelve null. */
export function promMineral(modo: 'abc' | 'prom', v?: ValorMineral | null): number | null {
  if (!v) return null;
  if (modo === 'prom') return v.prom != null && Number.isFinite(Number(v.prom)) ? Number(v.prom) : null;
  const xs = [v.a, v.b, v.c].filter((x) => x != null && Number.isFinite(Number(x))).map(Number);
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / 3;
}

/** Promedio del lote de un mineral = Σ(prom de cada análisis con valor) / cantidad de análisis con valor. */
export function promedioDelLote(modo: 'abc' | 'prom', clave: string, analisis: RecepcionAnalisis[]): number | null {
  const proms = analisis.map((a) => promMineral(modo, a.valores?.[clave])).filter((x): x is number => x != null);
  if (!proms.length) return null;
  return proms.reduce((a, b) => a + b, 0) / proms.length;
}

/* ───────────── Alta de recepción desde el cierre de caja (acopio) ───────────── */
/** La usa el cierre de caja/aliado: crea la recepción con el saldo de Kg de casiterita. */
export async function crearRecepcionDesdeCierre(input: {
  pesoKg: number; procedencia: string; centroNombre?: string | null;
  origen: 'cierre_caja' | 'cierre_aliado'; refCajaId?: string | null; refAliadoId?: string | null;
  actor: string; actorName?: string | null;
}): Promise<Recepcion | null> {
  if (num(input.pesoKg) <= 0) return null;
  return crearRecepcion({
    peso_kg: num(input.pesoKg), procedencia: input.procedencia, centro_nombre: input.centroNombre ?? null,
    origen: input.origen, ref_caja_id: input.refCajaId ?? null, ref_aliado_id: input.refAliadoId ?? null,
  }, input.actor, input.actorName ?? null);
}
