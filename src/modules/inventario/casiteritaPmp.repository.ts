/* ============================================================
   MGG · Los Pinos · Casiterita — Libro de promedios: lectura y escritura.
   Tablas: casiterita_libro, casiterita_procedencias_pmp
   (supabase/sql/casiterita-pmp-fase1-libro.sql).
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import type { CierreRecepcionPmp, ColadaCas, ExportacionCas, LoteCas, MovPmp, NuevoMovPmp, ProcedenciaPmp } from './casiteritaPmp';
import { calcularEntrada } from './casiteritaPmp';

/** true si el error dice que la tabla todavía no existe (falta correr el SQL de la fase). */
export function faltaTabla(e: unknown): boolean {
  const m = String((e as { message?: string; code?: string })?.message ?? '');
  const c = String((e as { code?: string })?.code ?? '');
  return c === '42P01' || c === 'PGRST205' || /does not exist|Could not find the table/i.test(m);
}

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

function aMov(r: Record<string, unknown>): MovPmp {
  return {
    id: String(r.id), fecha: String(r.fecha).slice(0, 10), tipo: r.tipo as MovPmp['tipo'], descripcion: String(r.descripcion ?? ''),
    kg: num(r.kg), kg_global: num(r.kg_global), kg_mgg: num(r.kg_mgg), costo: num(r.costo), afecta_mgg: r.afecta_mgg !== false,
    procedencia: (r.procedencia as string) ?? null, pct_mgg: num(r.pct_mgg), tasa: num(r.tasa),
    recepcion_numero: num(r.recepcion_numero), cierre_id: (r.cierre_id as string) ?? null, lote_id: (r.lote_id as string) ?? null,
    colada_id: (r.colada_id as string) ?? null, origen: r.origen === 'excel' ? 'excel' : 'sistema', orden: Number(r.orden) || 0,
    nota: (r.nota as string) ?? null, actor_name: (r.actor_name as string) ?? null, created_at: String(r.created_at ?? ''),
  };
}

export async function listLibroPmp(): Promise<MovPmp[]> {
  const { data, error } = await supabase.from('casiterita_libro').select('*').order('fecha').order('orden');
  if (error) throw error;
  return (data ?? []).map((r) => aMov(r as Record<string, unknown>));
}

export async function listProcedenciasPmp(): Promise<ProcedenciaPmp[]> {
  const { data, error } = await supabase.from('casiterita_procedencias_pmp').select('*').order('clave');
  if (error) throw error;
  return (data ?? []).map((r) => {
    const x = r as Record<string, unknown>;
    return { clave: String(x.clave), nombre: String(x.nombre ?? ''), pct_mgg: Number(x.pct_mgg) || 0, patron: (x.patron as string) ?? null, nota: (x.nota as string) ?? null, activo: x.activo !== false };
  });
}

export async function guardarProcedenciaPmp(p: ProcedenciaPmp, actorName: string | null, nueva = false): Promise<void> {
  const row = {
    clave: p.clave.trim().toUpperCase(), nombre: p.nombre.trim(), pct_mgg: p.pct_mgg, patron: p.patron?.trim() || null,
    nota: p.nota?.trim() || null, activo: p.activo, updated_at: new Date().toISOString(), updated_by_name: actorName,
  };
  if (!row.clave || !row.nombre) throw new Error('Clave y nombre son obligatorios.');
  if (!(row.pct_mgg >= 0 && row.pct_mgg <= 100)) throw new Error('El % MGG va de 0 a 100.');
  const q = nueva
    ? supabase.from('casiterita_procedencias_pmp').insert(row)
    : supabase.from('casiterita_procedencias_pmp').update(row).eq('clave', row.clave);
  const { error } = await q;
  if (error) throw error;
}

export interface ExtraMov {
  recepcion_numero?: number | null;
  cierre_id?: string | null;
  lote_id?: string | null;
  colada_id?: string | null;
  nota?: string | null;
}

/** Arma la fila a insertar (una entrada calcula su kg MGG y su costo). */
export function filaNuevoMov(m: NuevoMovPmp, extra: ExtraMov = {}, actorName: string | null = null): Record<string, unknown> {
  const base = {
    fecha: m.fecha, tipo: m.tipo, descripcion: m.descripcion.trim(), afecta_mgg: m.afecta_mgg !== false,
    procedencia: m.procedencia || null, actor_name: actorName,
    recepcion_numero: extra.recepcion_numero ?? null, cierre_id: extra.cierre_id ?? null, lote_id: extra.lote_id ?? null,
    colada_id: extra.colada_id ?? null, nota: extra.nota?.trim() || null,
  };
  if (m.tipo === 'entrada') {
    const kgG = Number(m.kg_global) || 0;
    const pct = Number(m.pct_mgg ?? 100);
    const tasa = Number(m.tasa) || 0;
    const { kgMgg, costo } = calcularEntrada(kgG, pct, tasa);
    return { ...base, kg: null, kg_global: kgG, kg_mgg: kgMgg, costo, pct_mgg: pct, tasa: tasa || null };
  }
  return { ...base, kg: Number(m.kg), kg_global: null, kg_mgg: null, costo: null, pct_mgg: null, tasa: null };
}

export async function crearMovPmp(m: NuevoMovPmp, extra: ExtraMov = {}, actorName: string | null = null): Promise<void> {
  const { error } = await supabase.from('casiterita_libro').insert(filaNuevoMov(m, extra, actorName));
  if (error) throw error;
}

export async function crearMovsPmp(movs: Array<{ m: NuevoMovPmp; extra?: ExtraMov }>, actorName: string | null = null): Promise<void> {
  if (!movs.length) return;
  const { error } = await supabase.from('casiterita_libro').insert(movs.map((x) => filaNuevoMov(x.m, x.extra ?? {}, actorName)));
  if (error) throw error;
}

export async function borrarMovPmp(id: string): Promise<void> {
  const { error } = await supabase.from('casiterita_libro').delete().eq('id', id);
  if (error) throw error;
}

/* ───────── Fase 2 · cierres de recepción con casiterita ───────── */

export async function listCierresCasiteritaPmp(): Promise<CierreRecepcionPmp[]> {
  const { data, error } = await supabase.from('recepcion_cierres')
    .select('id, numero, grupo_nombre, fecha, neto_seco, tasa_final, almacen_neto')
    .ilike('almacen_neto', '%CASITERITA%').gt('neto_seco', 0)
    .order('fecha', { ascending: false }).limit(300);
  if (error) throw error;
  return (data ?? []).map((r) => {
    const x = r as Record<string, unknown>;
    return {
      id: String(x.id), numero: Number(x.numero) || 0, grupo_nombre: (x.grupo_nombre as string) ?? null, fecha: String(x.fecha),
      neto_seco: num(x.neto_seco), tasa_final: num(x.tasa_final), almacen_neto: (x.almacen_neto as string) ?? null,
    };
  });
}

/* ───────── Fase 3 · exportaciones, lotes y fundición ───────── */
const BUCKET_SGS = 'casiterita-sgs';

export async function listExportacionesCas(): Promise<ExportacionCas[]> {
  const { data, error } = await supabase.from('casiterita_exportaciones').select('*').order('numero', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => {
    const x = r as Record<string, unknown>;
    return {
      id: String(x.id), numero: Number(x.numero) || 0, fecha: String(x.fecha).slice(0, 10), comprador: (x.comprador as string) ?? null,
      destino: (x.destino as string) ?? null, nota: (x.nota as string) ?? null, historico: x.historico === true,
    };
  });
}

export async function listLotesCas(): Promise<LoteCas[]> {
  const { data, error } = await supabase.from('casiterita_lotes').select('*').order('fecha', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => {
    const x = r as Record<string, unknown>;
    return {
      id: String(x.id), codigo: String(x.codigo), exportacion_id: String(x.exportacion_id), fecha: String(x.fecha).slice(0, 10),
      kg: Number(x.kg) || 0, muestras_kg: Number(x.muestras_kg) || 0, merma_kg: Number(x.merma_kg) || 0, ley_sgs: num(x.ley_sgs),
      informe_sgs_path: (x.informe_sgs_path as string) ?? null, precintos: (x.precintos as string) ?? null, motivo: (x.motivo as string) ?? null,
      estado: x.estado === 'despachado' ? 'despachado' : 'galpon', despachado_en: x.despachado_en ? String(x.despachado_en).slice(0, 10) : null,
      despachado_por_name: (x.despachado_por_name as string) ?? null, historico: x.historico === true,
      kg_mgg_hist: num(x.kg_mgg_hist), costo_hist: num(x.costo_hist), actor_name: (x.actor_name as string) ?? null,
    };
  });
}

/** Sube el informe SGS (PDF o foto) y devuelve su ruta en el bucket. */
export async function subirInformeSgs(file: File): Promise<string> {
  const ext = (file.name.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '') || 'pdf';
  const path = `lotes/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET_SGS).upload(path, file, { upsert: false, contentType: file.type || 'application/pdf' });
  if (error) throw error;
  return path;
}

export async function borrarInformeSgs(path: string | null | undefined): Promise<void> {
  if (!path) return;
  await supabase.storage.from(BUCKET_SGS).remove([path]).catch(() => undefined);
}

export async function urlInformeSgs(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET_SGS).createSignedUrl(path, 60 * 10);
  if (error || !data?.signedUrl) throw error ?? new Error('No se pudo abrir el informe.');
  return data.signedUrl;
}

export interface ArmarLoteInput {
  exportacionId: string | null;
  fecha: string;
  kg: number;
  muestras: number;
  merma: number;
  ley: number | null;
  precintos: string | null;
  motivo: string | null;
  informePath: string | null;
  comprador: string | null;
  destino: string | null;
}

export async function armarLoteCas(i: ArmarLoteInput): Promise<string> {
  const { data, error } = await supabase.rpc('casiterita_armar_lote', {
    p_exportacion_id: i.exportacionId, p_fecha: i.fecha, p_kg: i.kg, p_muestras: i.muestras, p_merma: i.merma, p_ley: i.ley,
    p_precintos: i.precintos, p_motivo: i.motivo, p_informe_path: i.informePath, p_comprador: i.comprador, p_destino: i.destino,
  });
  if (error) throw error;
  return String(data);
}

export async function despacharLoteCas(id: string, fecha: string): Promise<void> {
  const { error } = await supabase.rpc('casiterita_despachar_lote', { p_lote: id, p_fecha: fecha });
  if (error) throw error;
}

export async function deshacerLoteCas(id: string): Promise<void> {
  const { data, error } = await supabase.rpc('casiterita_deshacer_lote', { p_lote: id });
  if (error) throw error;
  await borrarInformeSgs(data as string | null);
}

export async function guardarSgsLoteCas(id: string, ley: number | null, informePath: string | null, precintos: string | null): Promise<void> {
  const { error } = await supabase.rpc('casiterita_sgs_lote', { p_lote: id, p_ley: ley, p_informe_path: informePath, p_precintos: precintos });
  if (error) throw error;
}

/** Coladas con la casiterita (big bags del detallado) que consumió cada una. */
export async function listColadasCasiterita(): Promise<ColadaCas[]> {
  const { data, error } = await supabase.from('produccion_colada').select('id, colada_num, fecha, datos');
  if (error) throw error;
  return (data ?? []).map((r) => {
    const x = r as { id: string; colada_num: number | null; fecha: string | null; datos?: { big_bags?: Array<{ origen_detalle_id?: string | null; kg?: number | string | null }> } | null };
    const bags = (x.datos?.big_bags ?? []).filter((b) => b.origen_detalle_id && (Number(b.kg) || 0) > 0);
    return {
      id: x.id, colada_num: Number(x.colada_num) || 0, fecha: x.fecha ? String(x.fecha).slice(0, 10) : null,
      kg: Math.round(bags.reduce((a, b) => a + (Number(b.kg) || 0), 0) * 100) / 100, bags: bags.length,
    };
  });
}

export async function listColadasCubiertas(): Promise<Map<string, string>> {
  const { data, error } = await supabase.from('casiterita_fundicion_coladas').select('colada_id, libro_id');
  if (error) throw error;
  return new Map((data ?? []).map((r) => [String((r as { colada_id: string }).colada_id), String((r as { libro_id: string }).libro_id)]));
}

export async function fundicionDesdeColadas(coladas: string[], fecha: string, kg: number, descripcion: string): Promise<void> {
  const { error } = await supabase.rpc('casiterita_fundicion_coladas', { p_coladas: coladas, p_fecha: fecha, p_kg: kg, p_descripcion: descripcion });
  if (error) throw error;
}
