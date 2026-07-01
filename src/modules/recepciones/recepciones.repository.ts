/* ============================================================
   MGG · RECEPCIONES (paso intermedio acopio → inventario)
   Al cerrar la caja de un centro/aliado de acopio, el SALDO EN KG de
   casiterita NO entra directo al inventario: se crea una RECEPCIÓN
   (peso + procedencia). El laboratorio carga aparte sus análisis
   (RECEPCIÓN GLOBAL LABORATORIO) por mineral configurable.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { registrarMovimiento } from '@/modules/inventario/movimientos.repository';
import { createProducto, findBySku } from '@/modules/inventario/inventario.repository';

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/* ───────────── Grupos (tarjetas de recepción) ─────────────
   La vista es por tarjeta (como Combustible). Hay una GENERAL y se pueden añadir más;
   todas las tablas de datos llevan grupo_id. Los minerales (columnas del laboratorio)
   son compartidos por todas las tarjetas. */
export interface RecepcionGrupo {
  id: string;
  nombre: string;
  orden: number;
  es_general: boolean;
  nota?: string | null;
  actor?: string | null;
  actor_name?: string | null;
  created_at: string;
  updated_at?: string | null;
}

export async function listGrupos(): Promise<RecepcionGrupo[]> {
  const { data, error } = await supabase.from('recepcion_grupos').select('*').order('es_general', { ascending: false }).order('orden', { ascending: true }).order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as RecepcionGrupo[];
}

/** Id del grupo GENERAL (lo crea si por algún motivo no existe). */
export async function grupoGeneralId(): Promise<string> {
  const { data } = await supabase.from('recepcion_grupos').select('id').eq('es_general', true).order('created_at', { ascending: true }).limit(1).maybeSingle();
  if (data?.id) return String((data as { id: string }).id);
  const { data: nuevo, error } = await supabase.from('recepcion_grupos').insert({ nombre: 'RECEPCIÓN GENERAL', orden: 0, es_general: true }).select('id').single();
  if (error) throw error;
  return String((nuevo as { id: string }).id);
}

export async function crearGrupo(nombre: string, actor: string, actorName?: string | null): Promise<RecepcionGrupo> {
  const n = nombre.trim();
  if (!n) throw new Error('Indicá el nombre de la recepción.');
  const { data: last } = await supabase.from('recepcion_grupos').select('orden').order('orden', { ascending: false }).limit(1).maybeSingle();
  const orden = (num((last as { orden?: number } | null)?.orden) || 0) + 1;
  const { data, error } = await supabase.from('recepcion_grupos').insert({ nombre: n, orden, es_general: false, actor, actor_name: actorName ?? null }).select('*').single();
  if (error) throw error;
  return data as RecepcionGrupo;
}

export async function actualizarGrupo(id: string, patch: { nombre?: string; nota?: string | null }): Promise<void> {
  const p: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.nombre !== undefined) { const n = patch.nombre.trim(); if (!n) throw new Error('El nombre no puede estar vacío.'); p.nombre = n; }
  if (patch.nota !== undefined) p.nota = patch.nota?.trim() || null;
  const { error } = await supabase.from('recepcion_grupos').update(p).eq('id', id);
  if (error) throw error;
}

/** Borra una tarjeta de recepción (y todos sus datos por cascada). No se puede borrar la GENERAL. */
export async function eliminarGrupo(id: string): Promise<void> {
  const { data } = await supabase.from('recepcion_grupos').select('es_general').eq('id', id).maybeSingle();
  if ((data as { es_general?: boolean } | null)?.es_general) throw new Error('No se puede borrar la RECEPCIÓN GENERAL.');
  const { error } = await supabase.from('recepcion_grupos').delete().eq('id', id);
  if (error) throw error;
}

/** Tarjeta de un centro de costo: "RECEPCIÓN <CENTRO>". La crea la 1ª vez y la reutiliza luego. */
export async function grupoParaCentro(nombreCentro: string, actor: string, actorName?: string | null): Promise<string> {
  const nombre = `RECEPCIÓN ${(nombreCentro || '').trim().toUpperCase()}`.trim();
  const { data } = await supabase.from('recepcion_grupos').select('id').eq('nombre', nombre).limit(1).maybeSingle();
  if (data?.id) return String((data as { id: string }).id);
  const g = await crearGrupo(nombre, actor, actorName);
  return g.id;
}

/* ───────────── Recepciones (tabla de arriba) ───────────── */
export interface Recepcion {
  id: string;
  item: number;
  fecha: string;
  peso_kg: number;
  tasa?: number | null;   // tasa del cierre (USD/Kg) → precarga el Precio/Tasa en Totales
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

export async function listRecepciones(grupoId: string): Promise<Recepcion[]> {
  const { data, error } = await supabase.from('recepciones').select('*').eq('grupo_id', grupoId).order('item', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Recepcion[];
}

/** Siguiente Item (correlativo): mayor item + 1, arranca en 1. Por grupo. */
export async function nextItemRecepcion(grupoId: string): Promise<number> {
  const { data } = await supabase.from('recepciones').select('item').eq('grupo_id', grupoId).order('item', { ascending: false }).limit(1).maybeSingle();
  return (num((data as { item?: number } | null)?.item) || 0) + 1;
}

export interface RecepcionInput {
  item?: number | null;
  fecha?: string | null;
  peso_kg: number;
  tasa?: number | null;
  procedencia: string;
  centro_nombre?: string | null;
  origen?: Recepcion['origen'];
  ref_caja_id?: string | null;
  ref_aliado_id?: string | null;
  nota?: string | null;
  grupo_id: string;
}

export async function crearRecepcion(input: RecepcionInput, actor: string, actorName?: string | null): Promise<Recepcion> {
  const item = input.item != null && Number(input.item) > 0 ? Math.floor(Number(input.item)) : await nextItemRecepcion(input.grupo_id);
  const row = {
    grupo_id: input.grupo_id,
    item,
    fecha: input.fecha || new Date().toISOString(),
    peso_kg: num(input.peso_kg),
    tasa: input.tasa != null && Number.isFinite(Number(input.tasa)) ? Number(input.tasa) : null,
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

export async function listAnalisis(grupoId: string): Promise<RecepcionAnalisis[]> {
  const { data, error } = await supabase.from('recepcion_analisis').select('*').eq('grupo_id', grupoId).order('n_analisis', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...(r as RecepcionAnalisis), valores: ((r as RecepcionAnalisis).valores ?? {}) }));
}

export async function nextNAnalisis(grupoId: string): Promise<number> {
  const { data } = await supabase.from('recepcion_analisis').select('n_analisis').eq('grupo_id', grupoId).order('n_analisis', { ascending: false }).limit(1).maybeSingle();
  return (num((data as { n_analisis?: number } | null)?.n_analisis) || 0) + 1;
}

export async function crearAnalisis(grupoId: string, input: { n_analisis?: number | null; fecha?: string | null; valores?: Record<string, ValorMineral>; nota?: string | null }, actor: string, actorName?: string | null): Promise<RecepcionAnalisis> {
  const n = input.n_analisis != null && Number(input.n_analisis) > 0 ? Math.floor(Number(input.n_analisis)) : await nextNAnalisis(grupoId);
  const { data, error } = await supabase.from('recepcion_analisis')
    .insert({ grupo_id: grupoId, n_analisis: n, fecha: input.fecha || new Date().toISOString(), valores: input.valores ?? {}, nota: input.nota?.trim() || null, actor, actor_name: actorName ?? null })
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
  pesoKg: number; tasa?: number | null; procedencia: string; centroNombre?: string | null;
  origen: 'cierre_caja' | 'cierre_aliado'; refCajaId?: string | null; refAliadoId?: string | null;
  actor: string; actorName?: string | null;
}): Promise<Recepcion | null> {
  if (num(input.pesoKg) <= 0) return null;
  // Cada cierre entra a la tarjeta del centro: "RECEPCIÓN <CENTRO>" (se crea la 1ª vez, luego se reutiliza).
  const nombreCentro = input.centroNombre || input.procedencia || 'GENERAL';
  const grupoId = await grupoParaCentro(nombreCentro, input.actor, input.actorName ?? null);
  return crearRecepcion({
    grupo_id: grupoId,
    peso_kg: num(input.pesoKg), tasa: input.tasa ?? null, procedencia: input.procedencia, centro_nombre: input.centroNombre ?? null,
    origen: input.origen, ref_caja_id: input.refCajaId ?? null, ref_aliado_id: input.refAliadoId ?? null,
  }, input.actor, input.actorName ?? null);
}

/* ───────────── Humedad (dos tablas bajo la grilla de análisis) ─────────────
   El cuerpo son entradas manuales; el pie "Promedio del lote" promedia los % y
   suma la merma. Solo las columnas de humedad se muestran en %. */
export interface HumedadProv {
  id: string;
  orden: number;
  peso_humedo: number | null;   // Peso (Gr) Húmedos
  peso_seco: number | null;     // Peso (Gr) seco
  pct_humedad: number | null;   // % Humedad
  merma_h2o: number | null;     // Merma peso H2O
  actor?: string | null;
  actor_name?: string | null;
  created_at: string;
  updated_at?: string | null;
}
export interface HumedadFinal {
  id: string;
  orden: number;
  peso_kg: number | null;       // Peso (Kg)
  peso_recogido: number | null; // Peso (Kg) recogido
  merma_h2o: number | null;     // Merma peso H2O (calculada: peso_kg - peso_recogido)
  pct_humedad: number | null;   // % Humedad final
  actor?: string | null;
  actor_name?: string | null;
  created_at: string;
  updated_at?: string | null;
}

/* — Humedad Provisional — */
export async function listHumedadProv(grupoId: string): Promise<HumedadProv[]> {
  const { data, error } = await supabase.from('recepcion_humedad_prov').select('*').eq('grupo_id', grupoId).order('orden', { ascending: true }).order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as HumedadProv[];
}
export async function crearHumedadProv(grupoId: string, actor: string, actorName?: string | null): Promise<HumedadProv> {
  const { data: last } = await supabase.from('recepcion_humedad_prov').select('orden').eq('grupo_id', grupoId).order('orden', { ascending: false }).limit(1).maybeSingle();
  const orden = (num((last as { orden?: number } | null)?.orden) || 0) + 1;
  const { data, error } = await supabase.from('recepcion_humedad_prov')
    .insert({ grupo_id: grupoId, orden, actor, actor_name: actorName ?? null }).select('*').single();
  if (error) throw error;
  return data as HumedadProv;
}
export async function actualizarHumedadProv(id: string, patch: Partial<Pick<HumedadProv, 'peso_humedo' | 'peso_seco' | 'pct_humedad' | 'merma_h2o'>>): Promise<void> {
  const p: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of ['peso_humedo', 'peso_seco', 'pct_humedad', 'merma_h2o'] as const) {
    if (patch[k] !== undefined) p[k] = patch[k];
  }
  const { error } = await supabase.from('recepcion_humedad_prov').update(p).eq('id', id);
  if (error) throw error;
}
export async function eliminarHumedadProv(id: string): Promise<void> {
  const { error } = await supabase.from('recepcion_humedad_prov').delete().eq('id', id);
  if (error) throw error;
}

/* — Humedad Final — */
export async function listHumedadFinal(grupoId: string): Promise<HumedadFinal[]> {
  const { data, error } = await supabase.from('recepcion_humedad_final').select('*').eq('grupo_id', grupoId).order('orden', { ascending: true }).order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as HumedadFinal[];
}
export async function crearHumedadFinal(grupoId: string, actor: string, actorName?: string | null): Promise<HumedadFinal> {
  const { data: last } = await supabase.from('recepcion_humedad_final').select('orden').eq('grupo_id', grupoId).order('orden', { ascending: false }).limit(1).maybeSingle();
  const orden = (num((last as { orden?: number } | null)?.orden) || 0) + 1;
  const { data, error } = await supabase.from('recepcion_humedad_final')
    .insert({ grupo_id: grupoId, orden, actor, actor_name: actorName ?? null }).select('*').single();
  if (error) throw error;
  return data as HumedadFinal;
}
export async function actualizarHumedadFinal(id: string, patch: Partial<Pick<HumedadFinal, 'peso_kg' | 'peso_recogido' | 'merma_h2o' | 'pct_humedad'>>): Promise<void> {
  const p: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of ['peso_kg', 'peso_recogido', 'merma_h2o', 'pct_humedad'] as const) {
    if (patch[k] !== undefined) p[k] = patch[k];
  }
  const { error } = await supabase.from('recepcion_humedad_final').update(p).eq('id', id);
  if (error) throw error;
}
export async function eliminarHumedadFinal(id: string): Promise<void> {
  const { error } = await supabase.from('recepcion_humedad_final').delete().eq('id', id);
  if (error) throw error;
}

/** Promedio (Σ ÷ cantidad) de los valores no nulos. Para los % del pie. */
export function promedioCol(vals: Array<number | null | undefined>): number | null {
  const xs = vals.filter((x): x is number => x != null && Number.isFinite(Number(x))).map(Number);
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
/** Suma de los valores no nulos. Para la Merma peso H2O y el Peso recogido del pie. */
export function sumaCol(vals: Array<number | null | undefined>): number {
  return vals.reduce((acc: number, x) => acc + (x != null && Number.isFinite(Number(x)) ? Number(x) : 0), 0);
}

/* ───────────── Pesajes de bigbags (Pesos Húmedos / Pesos Secos) ─────────────
   Histórico modificable. Cada fila tiene procedencia + peso de cada lado, su
   categoría (big bag ×1,5 · saco ×0,06 · hielo ×0,05) y su cantidad.
   DESCUENTO = −Σ (factor × cantidad) de cada fila con peso (ej. 7 big bags → −1,5×7)
   TOTAL NETO = Σ pesos + DESCUENTO (permite negativos). */
/** Categoría (deducción) de cada fila del pesaje. En una misma corrida pueden convivir
 *  las 3: big bag (×1,5), saco (×0,06) y bolsa de hielo (×0,05). */
export type PesoModo = 'bigbag' | 'saco' | 'hielo';
export const PESO_FACTOR: Record<PesoModo, number> = { bigbag: 1.5, saco: 0.06, hielo: 0.05 };
export interface PesajeBigbag {
  proc_h: string | null;   // procedencia (húmedo): A, B, Ali, ...
  peso_h: number | null;   // peso húmedo
  proc_s: string | null;   // procedencia (seco)
  peso_s: number | null;   // peso seco
  categoria?: PesoModo;    // bigbag (def.) · saco · hielo — su factor define la deducción de la fila
  cant?: number;           // cantidad de la categoría (ej. 7 bigbags) → deducción = factor × cant (def. 1)
}
export interface RecepcionPesaje {
  id: string;
  item: number;
  fecha: string;
  bigbags: PesajeBigbag[];
  factor: number;
  modo: PesoModo;
  total_neto_humedo: number | null;
  total_neto_seco: number | null;
  nota?: string | null;
  actor?: string | null;
  actor_name?: string | null;
  created_at: string;
  updated_at?: string | null;
}

export async function listPesajes(grupoId: string): Promise<RecepcionPesaje[]> {
  const { data, error } = await supabase.from('recepcion_pesajes').select('*').eq('grupo_id', grupoId).order('item', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...(r as RecepcionPesaje), bigbags: ((r as RecepcionPesaje).bigbags ?? []) as PesajeBigbag[] }));
}

export async function nextItemPesaje(grupoId: string): Promise<number> {
  const { data } = await supabase.from('recepcion_pesajes').select('item').eq('grupo_id', grupoId).order('item', { ascending: false }).limit(1).maybeSingle();
  return (num((data as { item?: number } | null)?.item) || 0) + 1;
}

/** Deducción del lado = −Σ (factor × cantidad) de cada fila CON peso (según su categoría).
 *  Ej.: 7 big bags → −1,5 × 7. Filas sin categoría (datos viejos) cuentan como big bag (×1,5);
 *  sin cantidad, cuentan como 1. */
export function bigBagLado(bigbags: PesajeBigbag[], lado: 'h' | 's'): number {
  return -bigbags.reduce((a, b) => {
    const peso = num(lado === 'h' ? b.peso_h : b.peso_s);
    if (peso <= 0) return a;
    const factor = PESO_FACTOR[(b.categoria ?? 'bigbag') as PesoModo] ?? PESO_FACTOR.bigbag;
    const cant = num(b.cant) > 0 ? num(b.cant) : 1;
    return a + factor * cant;
  }, 0);
}
/** Σ pesos del lado + deducción (puede ser negativo). */
export function totalNetoLado(bigbags: PesajeBigbag[], lado: 'h' | 's'): number {
  const suma = bigbags.reduce((a, b) => a + num(lado === 'h' ? b.peso_h : b.peso_s), 0);
  return suma + bigBagLado(bigbags, lado);
}

export interface PesajeInput {
  grupo_id: string;
  item?: number | null;
  fecha?: string | null;
  bigbags: PesajeBigbag[];
  factor?: number;
  modo?: PesoModo;
  nota?: string | null;
}

function limpiarBigbags(bigbags: PesajeBigbag[]): PesajeBigbag[] {
  return bigbags.map((b) => ({
    proc_h: b.proc_h?.toString().trim() || null,
    peso_h: b.peso_h != null && Number.isFinite(Number(b.peso_h)) ? Number(b.peso_h) : null,
    proc_s: b.proc_s?.toString().trim() || null,
    peso_s: b.peso_s != null && Number.isFinite(Number(b.peso_s)) ? Number(b.peso_s) : null,
    categoria: (b.categoria ?? 'bigbag') as PesoModo,
    cant: b.cant != null && Number.isFinite(Number(b.cant)) && Number(b.cant) > 0 ? Number(b.cant) : 1,
  }));
}

export async function crearPesaje(input: PesajeInput, actor: string, actorName?: string | null): Promise<RecepcionPesaje> {
  const item = input.item != null && Number(input.item) > 0 ? Math.floor(Number(input.item)) : await nextItemPesaje(input.grupo_id);
  const bigbags = limpiarBigbags(input.bigbags);
  const row = {
    grupo_id: input.grupo_id,
    item, fecha: input.fecha || new Date().toISOString(), bigbags, factor: 1.5,
    modo: input.modo ?? 'bigbag',
    total_neto_humedo: totalNetoLado(bigbags, 'h'),
    total_neto_seco: totalNetoLado(bigbags, 's'),
    nota: input.nota?.trim() || null, actor, actor_name: actorName ?? null,
  };
  const { data, error } = await supabase.from('recepcion_pesajes').insert(row).select('*').single();
  if (error) throw error;
  return data as RecepcionPesaje;
}

export async function actualizarPesaje(id: string, patch: Partial<PesajeInput>): Promise<void> {
  const p: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.item !== undefined) p.item = Math.floor(Number(patch.item) || 0);
  if (patch.fecha !== undefined) p.fecha = patch.fecha;
  if (patch.nota !== undefined) p.nota = patch.nota?.trim() || null;
  if (patch.modo !== undefined) p.modo = patch.modo;
  if (patch.bigbags !== undefined) {
    const bigbags = limpiarBigbags(patch.bigbags);
    p.bigbags = bigbags;
    p.total_neto_humedo = totalNetoLado(bigbags, 'h');
    p.total_neto_seco = totalNetoLado(bigbags, 's');
  }
  const { error } = await supabase.from('recepcion_pesajes').update(p).eq('id', id);
  if (error) throw error;
}

export async function eliminarPesaje(id: string): Promise<void> {
  const { error } = await supabase.from('recepcion_pesajes').delete().eq('id', id);
  if (error) throw error;
}

/* ───────────── Conciliación de Centros de Acopio ─────────────
   Toma los nombres de los centros/aliados y sus Saldos en Kg (del cierre de caja).
   Total Reportado = Σ saldos · Kg Faltante = Peso KG TOTAL − Total Reportado
   Kg No Llegó = Faltante + Bolsas + Muestras · % no llegó = No Llegó ÷ Total Reportado × 100. */
export interface CentroConcil {
  nombre: string | null;   // ej. "P-MGG04- A LOS PIJIGUAOS" (centro o aliado)
  saldo_kg: number | null; // Saldo en Kg
  /** Categoría del centro. 'resguardo' = NO suma; se RESTA del total y puede entrar al inventario. */
  categoria?: 'resguardo' | null;
  /** Solo resguardo: ¿ese Saldo de Kg entra al inventario REAL (casiterita)? */
  entra_inventario?: boolean | null;
  /** Solo resguardo que entra: almacén destino del inventario. */
  almacen?: string | null;
  /** Id del movimiento de inventario una vez ingresado (idempotencia: no se reingresa). */
  inventario_mov_id?: string | null;
}
export interface RecepcionConciliacion {
  id: string;
  numero: number;
  fecha: string;
  centros: CentroConcil[];
  peso_kg_total: number | null;
  kg_peso_bolsas: number | null;
  muestras_laboratorio: number | null;
  total_reportado: number | null;
  kg_faltante: number | null;
  kg_no_llego: number | null;
  pct_no_llego: number | null;
  /** Tasa USD/Kg con la que el TOTAL NETO seco entra al inventario. */
  tasa?: number | null;
  neto_seco?: number | null;        // Σ total_neto_seco de los pesajes que entró
  almacen_neto?: string | null;     // almacén destino del neto seco
  neto_seco_mov_id?: string | null; // idempotencia: ya entró
  nota?: string | null;
  actor?: string | null;
  actor_name?: string | null;
  created_at: string;
  updated_at?: string | null;
}

/** Σ de total_neto_seco de TODOS los pesajes de una tarjeta (lo que entra al inventario). */
export async function sumaNetoSecoGrupo(grupoId: string): Promise<number> {
  const { data, error } = await supabase.from('recepcion_pesajes').select('total_neto_seco').eq('grupo_id', grupoId);
  if (error) throw error;
  return (data ?? []).reduce((a, r) => a + num((r as { total_neto_seco?: number }).total_neto_seco), 0);
}

export async function listConciliaciones(grupoId: string): Promise<RecepcionConciliacion[]> {
  const { data, error } = await supabase.from('recepcion_conciliaciones').select('*').eq('grupo_id', grupoId).order('numero', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...(r as RecepcionConciliacion), centros: ((r as RecepcionConciliacion).centros ?? []) as CentroConcil[] }));
}

/** Siguiente número: último + 1 (arranca en 1; la 1ª vez el usuario puede cambiarlo). */
export async function nextNumeroConciliacion(): Promise<number> {
  const { data } = await supabase.from('recepcion_conciliaciones').select('numero').order('numero', { ascending: false }).limit(1).maybeSingle();
  return (num((data as { numero?: number } | null)?.numero) || 0) + 1;
}

/* — Cálculos — */
/** Los centros normales SUMAN; los de categoría 'resguardo' NO suman, RESTAN del total. */
export function totalReportadoConcil(centros: CentroConcil[]): number {
  return centros.reduce((a, c) => (c.categoria === 'resguardo' ? a - num(c.saldo_kg) : a + num(c.saldo_kg)), 0);
}
export function kgFaltanteConcil(pesoKgTotal: number | null, totalReportado: number): number {
  return num(pesoKgTotal) - totalReportado;
}
export function kgNoLlegoConcil(kgFaltante: number, bolsas: number | null, muestras: number | null): number {
  return kgFaltante + num(bolsas) + num(muestras);
}
export function pctNoLlegoConcil(kgNoLlego: number, totalReportado: number): number | null {
  return totalReportado !== 0 ? (kgNoLlego / totalReportado) * 100 : null;
}

export interface ConciliacionInput {
  grupo_id: string;
  numero: number;
  fecha?: string | null;
  centros: CentroConcil[];
  peso_kg_total?: number | null;
  kg_peso_bolsas?: number | null;
  muestras_laboratorio?: number | null;
  tasa?: number | null;          // USD/Kg para valuar el TOTAL NETO seco al entrar al inventario
  almacen_neto?: string | null;  // almacén destino del neto seco
  nota?: string | null;
}

function snapshotConcil(input: ConciliacionInput) {
  const centros: CentroConcil[] = input.centros.map((c) => {
    const esResguardo = c.categoria === 'resguardo';
    const entra = esResguardo ? !!c.entra_inventario : false;
    return {
      nombre: c.nombre?.toString().trim() || null,
      saldo_kg: c.saldo_kg != null && Number.isFinite(Number(c.saldo_kg)) ? Number(c.saldo_kg) : null,
      categoria: esResguardo ? ('resguardo' as const) : null,
      entra_inventario: entra,
      almacen: entra ? (c.almacen?.toString().trim() || null) : null,
      inventario_mov_id: c.inventario_mov_id ?? null,
    };
  });
  const totalReportado = totalReportadoConcil(centros);
  const kgFaltante = kgFaltanteConcil(input.peso_kg_total ?? null, totalReportado);
  const kgNoLlego = kgNoLlegoConcil(kgFaltante, input.kg_peso_bolsas ?? null, input.muestras_laboratorio ?? null);
  const pctNoLlego = pctNoLlegoConcil(kgNoLlego, totalReportado);
  return { centros, totalReportado, kgFaltante, kgNoLlego, pctNoLlego };
}

/* — Entrada al inventario REAL de los resguardos (casiterita), SIN tasa — */
/** Producto único (casiterita) donde se acumulan los resguardos. Lo crea la 1ª vez. */
async function productoResguardoId(almacen: string): Promise<string> {
  const SKU = 'MIN-CASITERITA';
  const ex = await findBySku(SKU);
  if (ex) return ex.id;
  const prod = await createProducto({
    sku: SKU, nombre: 'CASITERITA', categoria: 'MINERALES', unidad: 'KG',
    stock: 0, stock_min: 0, precio: 0, almacen, estado: 'activo',
  });
  return prod.id;
}

/** Entrada de un resguardo al inventario REAL. SIN TASA: precio_unitario null → no altera el PMP. */
async function entrarResguardo(cantidadKg: number, almacen: string, refId: string | null, nombreCentro: string | null, actor: string, actorName: string | null): Promise<string> {
  const productoId = await productoResguardoId(almacen);
  const mov = await registrarMovimiento({
    producto_id: productoId, tipo: 'entrada', delta: num(cantidadKg), almacen,
    actor, actor_name: actorName ?? null,
    ref_tipo: 'recepcion_resguardo', ref_id: refId,
    detalle: `Resguardo de conciliación (sin tasa)${nombreCentro ? ` · ${nombreCentro}` : ''}`,
    precio_unitario: null,
  });
  return mov.id;
}

/** Entrada del TOTAL NETO seco (Σ pesajes) al inventario REAL, valuado a la TASA FINAL de Totales.
 *  Se dispara al CERRAR la recepción, en el almacén/subalmacén asignado en el cierre.
 *  precio_unitario = tasa → recalcula el PMP del almacén con ese costo. */
async function entrarNetoSeco(cantidadKg: number, almacen: string, tasa: number, refId: string | null, actor: string, actorName: string | null): Promise<string> {
  const productoId = await productoResguardoId(almacen);
  const mov = await registrarMovimiento({
    producto_id: productoId, tipo: 'entrada', delta: num(cantidadKg), almacen,
    actor, actor_name: actorName ?? null,
    ref_tipo: 'recepcion_neto_seco', ref_id: refId,
    detalle: `Neto seco al cerrar la recepción a ${tasa} USD/Kg`,
    precio_unitario: num(tasa) > 0 ? num(tasa) : null,
  });
  return mov.id;
}

/** Por cada resguardo que entra al inventario y aún no tiene movimiento, lo ingresa
 *  y le estampa el id (idempotente: no se reingresa si ya tiene inventario_mov_id). */
async function procesarResguardos(refId: string | null, centros: CentroConcil[], actor: string, actorName: string | null): Promise<{ centros: CentroConcil[]; cambio: boolean }> {
  let cambio = false;
  const out: CentroConcil[] = [];
  for (const c of centros) {
    if (c.categoria === 'resguardo' && c.entra_inventario && c.almacen && !c.inventario_mov_id && num(c.saldo_kg) > 0) {
      const movId = await entrarResguardo(num(c.saldo_kg), c.almacen, refId, c.nombre, actor, actorName);
      out.push({ ...c, inventario_mov_id: movId });
      cambio = true;
    } else {
      out.push(c);
    }
  }
  return { centros: out, cambio };
}

export async function crearConciliacion(input: ConciliacionInput, actor: string, actorName?: string | null): Promise<RecepcionConciliacion> {
  const s = snapshotConcil(input);
  const row = {
    grupo_id: input.grupo_id,
    numero: Math.floor(Number(input.numero) || 0),
    fecha: input.fecha || new Date().toISOString(),
    centros: s.centros,
    peso_kg_total: input.peso_kg_total ?? null,
    kg_peso_bolsas: input.kg_peso_bolsas ?? null,
    muestras_laboratorio: input.muestras_laboratorio ?? null,
    total_reportado: s.totalReportado, kg_faltante: s.kgFaltante, kg_no_llego: s.kgNoLlego, pct_no_llego: s.pctNoLlego,
    tasa: input.tasa ?? null, almacen_neto: input.almacen_neto?.trim() || null,
    nota: input.nota?.trim() || null, actor, actor_name: actorName ?? null,
  };
  const { data, error } = await supabase.from('recepcion_conciliaciones').insert(row).select('*').single();
  if (error) throw error;
  const created = data as RecepcionConciliacion;
  // Resguardos → inventario REAL (con el id ya disponible para la trazabilidad).
  // El TOTAL NETO seco YA NO entra aquí: entra al CERRAR la recepción, valuado a
  // la tasa_final de Totales y en el almacén/subalmacén que se asigna en el cierre.
  const res = await procesarResguardos(created.id, s.centros, actor, actorName ?? null);
  if (res.cambio) {
    await supabase.from('recepcion_conciliaciones').update({ centros: res.centros }).eq('id', created.id);
    created.centros = res.centros;
  }
  return created;
}

export async function actualizarConciliacion(id: string, input: ConciliacionInput, actor: string, actorName?: string | null): Promise<void> {
  const s = snapshotConcil(input);
  const res = await procesarResguardos(id, s.centros, actor, actorName ?? null);
  // El neto seco ya no entra desde la conciliación (entra al cerrar la recepción).
  const p: Record<string, unknown> = {
    numero: Math.floor(Number(input.numero) || 0),
    centros: res.centros,
    peso_kg_total: input.peso_kg_total ?? null,
    kg_peso_bolsas: input.kg_peso_bolsas ?? null,
    muestras_laboratorio: input.muestras_laboratorio ?? null,
    total_reportado: s.totalReportado, kg_faltante: s.kgFaltante, kg_no_llego: s.kgNoLlego, pct_no_llego: s.pctNoLlego,
    tasa: input.tasa ?? null, almacen_neto: input.almacen_neto?.trim() || null,
    nota: input.nota?.trim() || null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('recepcion_conciliaciones').update(p).eq('id', id);
  if (error) throw error;
}

export async function eliminarConciliacion(id: string): Promise<void> {
  const { error } = await supabase.from('recepcion_conciliaciones').delete().eq('id', id);
  if (error) throw error;
}

/* ───────────── Totales (PROMEDIO DE PRECIO DE COMPRA) ─────────────
   Por centro: Total Moneda = Total SnO2 × Precio/Tasa.
   PROMEDIO RECEPCIONADA: Tasa = Total Moneda ÷ Total Pesos Kg.
   PROMEDIO COSTO FINAL:  SnO2 = Pesos Kg + Humedad Prov + Humedad Final + Fe esteril
                          Total Moneda = (Σ 3 filas) ó, si es 0, el Total Moneda recepcionado
                          Tasa = Total Moneda ÷ SnO2. */
export interface CentroTotal {
  nombre: string | null;   // nombre del centro de costo
  sno2: number | null;     // Total SnO2 (saldo de Kg del cierre)
  precio: number | null;   // Precio / Tasa
}
export interface RecepcionTotales {
  id: string;
  numero: number;
  fecha: string;
  centros: CentroTotal[];
  gastos: number | null;
  pesos_kg: number | null;
  humedad_prov: number | null;
  humedad_final: number | null;
  fe_esteril: number | null;
  total_sno2: number | null;
  total_moneda: number | null;
  tasa_recepcionada: number | null;
  total_sno2_final: number | null;
  total_moneda_final: number | null;
  tasa_final: number | null;
  nota?: string | null;
  actor?: string | null;
  actor_name?: string | null;
  created_at: string;
  updated_at?: string | null;
}

export async function listTotales(grupoId: string): Promise<RecepcionTotales[]> {
  const { data, error } = await supabase.from('recepcion_totales').select('*').eq('grupo_id', grupoId).order('numero', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...(r as RecepcionTotales), centros: ((r as RecepcionTotales).centros ?? []) as CentroTotal[] }));
}

/* — Cálculos — */
export const totalMonedaCentro = (c: CentroTotal): number => num(c.sno2) * num(c.precio);
export const sumSnO2 = (centros: CentroTotal[]): number => centros.reduce((a, c) => a + num(c.sno2), 0);
export const sumMonedaCentros = (centros: CentroTotal[]): number => centros.reduce((a, c) => a + totalMonedaCentro(c), 0);
/** Total Moneda = Σ(sno2×precio) + gastos. */
export const totalMonedaTotal = (centros: CentroTotal[], gastos: number | null): number => sumMonedaCentros(centros) + num(gastos);
/** Tasa recepcionada = Total Moneda ÷ Total Pesos Kg. */
export const tasaRecepcionada = (totalMoneda: number, pesosKg: number | null): number | null => (num(pesosKg) !== 0 ? totalMoneda / num(pesosKg) : null);

export interface TotalesInput {
  grupo_id: string;
  numero: number;
  fecha?: string | null;
  centros: CentroTotal[];
  gastos?: number | null;
  pesos_kg?: number | null;
  humedad_prov?: number | null;
  humedad_final?: number | null;
  fe_esteril?: number | null;
  nota?: string | null;
}

function snapshotTotales(input: TotalesInput) {
  const centros = input.centros.map((c) => ({
    nombre: c.nombre?.toString().trim() || null,
    sno2: c.sno2 != null && Number.isFinite(Number(c.sno2)) ? Number(c.sno2) : null,
    precio: c.precio != null && Number.isFinite(Number(c.precio)) ? Number(c.precio) : null,
  }));
  const totalSnO2 = sumSnO2(centros);
  const totalMoneda = totalMonedaTotal(centros, input.gastos ?? null);
  const pesosKg = num(input.pesos_kg);
  const tasaRec = tasaRecepcionada(totalMoneda, input.pesos_kg ?? null);
  const sum3 = num(input.humedad_prov) + num(input.humedad_final) + num(input.fe_esteril);
  const totalSnO2Final = pesosKg + sum3;
  const totalMonedaFinal = sum3 !== 0 ? sum3 : totalMoneda;
  const tasaFinal = totalSnO2Final !== 0 ? totalMonedaFinal / totalSnO2Final : null;
  return { centros, totalSnO2, totalMoneda, tasaRec, totalSnO2Final, totalMonedaFinal, tasaFinal };
}

export async function crearTotales(input: TotalesInput, actor: string, actorName?: string | null): Promise<RecepcionTotales> {
  const s = snapshotTotales(input);
  const row = {
    grupo_id: input.grupo_id,
    numero: Math.floor(Number(input.numero) || 0),
    fecha: input.fecha || new Date().toISOString(),
    centros: s.centros,
    gastos: input.gastos ?? null, pesos_kg: input.pesos_kg ?? null,
    humedad_prov: input.humedad_prov ?? null, humedad_final: input.humedad_final ?? null, fe_esteril: input.fe_esteril ?? null,
    total_sno2: s.totalSnO2, total_moneda: s.totalMoneda, tasa_recepcionada: s.tasaRec,
    total_sno2_final: s.totalSnO2Final, total_moneda_final: s.totalMonedaFinal, tasa_final: s.tasaFinal,
    nota: input.nota?.trim() || null, actor, actor_name: actorName ?? null,
  };
  const { data, error } = await supabase.from('recepcion_totales').insert(row).select('*').single();
  if (error) throw error;
  return data as RecepcionTotales;
}

export async function actualizarTotales(id: string, input: TotalesInput): Promise<void> {
  const s = snapshotTotales(input);
  const p = {
    numero: Math.floor(Number(input.numero) || 0),
    centros: s.centros,
    gastos: input.gastos ?? null, pesos_kg: input.pesos_kg ?? null,
    humedad_prov: input.humedad_prov ?? null, humedad_final: input.humedad_final ?? null, fe_esteril: input.fe_esteril ?? null,
    total_sno2: s.totalSnO2, total_moneda: s.totalMoneda, tasa_recepcionada: s.tasaRec,
    total_sno2_final: s.totalSnO2Final, total_moneda_final: s.totalMonedaFinal, tasa_final: s.tasaFinal,
    nota: input.nota?.trim() || null, updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('recepcion_totales').update(p).eq('id', id);
  if (error) throw error;
}

export async function eliminarTotales(id: string): Promise<void> {
  const { error } = await supabase.from('recepcion_totales').delete().eq('id', id);
  if (error) throw error;
}

/* ───────────── CERRAR RECEPCIÓN · snapshot de toda la tarjeta ───────────── */
export interface RecepcionCierre {
  id: string;
  grupo_id: string | null;
  grupo_nombre: string | null;
  numero: number;
  fecha: string;
  datos: Record<string, unknown>;
  // TOTAL NETO seco que entró al inventario al cerrar (valuado a tasa_final).
  neto_seco?: number | null;
  tasa_final?: number | null;
  almacen_neto?: string | null;
  neto_seco_mov_id?: string | null;
  nota?: string | null;
  actor?: string | null;
  actor_name?: string | null;
  created_at: string;
  updated_at?: string | null;
}

export async function listCierres(grupoId: string): Promise<RecepcionCierre[]> {
  const { data, error } = await supabase.from('recepcion_cierres').select('*').eq('grupo_id', grupoId).order('numero', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...(r as RecepcionCierre), datos: ((r as RecepcionCierre).datos ?? {}) }));
}

/** Siguiente número de cierre (global): último + 1. La 1ª vez el usuario lo puede cambiar. */
export async function nextNumeroCierre(): Promise<number> {
  const { data } = await supabase.from('recepcion_cierres').select('numero').order('numero', { ascending: false }).limit(1).maybeSingle();
  return (num((data as { numero?: number } | null)?.numero) || 0) + 1;
}

export async function crearCierre(
  input: {
    grupoId: string; grupoNombre: string; numero: number; datos: Record<string, unknown>; nota?: string | null;
    // Al cerrar: el TOTAL NETO seco (Σ pesajes) entra al inventario valuado a la
    // tasa_final de Totales, en el almacén/subalmacén asignado en el cierre.
    tasaFinal?: number | null; almacenNeto?: string | null;
  },
  actor: string, actorName?: string | null,
): Promise<RecepcionCierre> {
  // 1) Entrada al inventario del neto seco (si hay tasa final + almacén y hay Kg).
  const netoSeco = await sumaNetoSecoGrupo(input.grupoId);
  let netoSecoMovId: string | null = null;
  const tasaFinal = num(input.tasaFinal);
  const almacenNeto = input.almacenNeto?.trim() || null;
  if (netoSeco > 0 && tasaFinal > 0 && almacenNeto) {
    netoSecoMovId = await entrarNetoSeco(netoSeco, almacenNeto, tasaFinal, null, actor, actorName ?? null);
  }
  // 2) Snapshot del cierre (con la trazabilidad de la entrada al inventario).
  const row = {
    grupo_id: input.grupoId, grupo_nombre: input.grupoNombre,
    numero: Math.floor(Number(input.numero) || 0),
    fecha: new Date().toISOString(),
    datos: input.datos ?? {},
    neto_seco: netoSeco > 0 ? netoSeco : null,
    tasa_final: tasaFinal > 0 ? tasaFinal : null,
    almacen_neto: netoSecoMovId ? almacenNeto : null,
    neto_seco_mov_id: netoSecoMovId,
    nota: input.nota?.trim() || null, actor, actor_name: actorName ?? null,
  };
  const { data, error } = await supabase.from('recepcion_cierres').insert(row).select('*').single();
  if (error) throw error;
  // 3) Vaciar la tarjeta: el cierre ya guardó copia de TODO en el histórico (datos jsonb).
  //    Se borran solo las tablas por-tarjeta (grupo_id). NO se toca recepcion_minerales
  //    (config global de columnas de laboratorio, compartida por todas las tarjetas).
  await limpiarDatosGrupo(input.grupoId);
  return data as RecepcionCierre;
}

/** Borra TODOS los datos por-tarjeta de un grupo (recepciones, laboratorio·lecturas,
 *  humedad prov/final, pesajes, conciliaciones, totales). Deja la tarjeta en blanco.
 *  La config global de minerales (columnas) y los cierres (histórico) se conservan. */
async function limpiarDatosGrupo(grupoId: string): Promise<void> {
  const tablas = [
    'recepciones', 'recepcion_analisis', 'recepcion_humedad_prov',
    'recepcion_humedad_final', 'recepcion_pesajes', 'recepcion_conciliaciones', 'recepcion_totales',
  ] as const;
  for (const t of tablas) {
    const { error } = await supabase.from(t).delete().eq('grupo_id', grupoId);
    if (error) throw error;
  }
}

export async function eliminarCierre(id: string, actor?: string, actorName?: string | null): Promise<void> {
  // Si el cierre entró neto seco al inventario, lo revertimos (salida) para no dejar stock fantasma.
  const { data: row } = await supabase
    .from('recepcion_cierres')
    .select('numero, neto_seco, almacen_neto, neto_seco_mov_id')
    .eq('id', id)
    .maybeSingle();
  const c = row as { numero?: number; neto_seco?: number | null; almacen_neto?: string | null; neto_seco_mov_id?: string | null } | null;
  if (c?.neto_seco_mov_id && c.almacen_neto && num(c.neto_seco) > 0) {
    const productoId = await productoResguardoId(c.almacen_neto);
    await registrarMovimiento({
      producto_id: productoId, tipo: 'salida', delta: -num(c.neto_seco), almacen: c.almacen_neto,
      actor: actor ?? 'sistema', actor_name: actorName ?? null,
      ref_tipo: 'recepcion_neto_seco_reversa', ref_id: id,
      detalle: `Reversa de neto seco · cierre N° ${c.numero ?? ''} eliminado`,
      precio_unitario: null,
    });
  }
  const { error } = await supabase.from('recepcion_cierres').delete().eq('id', id);
  if (error) throw error;
}
