/* ============================================================
   MGG · Los Pinos · Casiterita — Libro de promedios: lectura y escritura.
   Tablas: casiterita_libro, casiterita_procedencias_pmp
   (supabase/sql/casiterita-pmp-fase1-libro.sql).
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import type { MovPmp, NuevoMovPmp, ProcedenciaPmp } from './casiteritaPmp';
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
