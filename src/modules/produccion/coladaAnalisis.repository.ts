/* ============================================================
   MGG · ANÁLISIS QUÍMICO por colada (fundición)
   Mismo modelo que el laboratorio de Recepciones (recepcion_analisis),
   pero atado a la orden de fundición (produccion_id). Reutiliza el
   catálogo de minerales/procedencias de Recepciones. 1 colada → N lecturas.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import type { RecepcionAnalisis, ValorMineral } from '@/modules/recepciones/recepciones.repository';

const TABLE = 'colada_analisis';
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Lecturas de laboratorio de una colada (por su orden de fundición). */
export async function listColadaAnalisis(produccionId: string): Promise<RecepcionAnalisis[]> {
  const { data, error } = await supabase.from(TABLE).select('*').eq('produccion_id', produccionId).order('n_analisis', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...(r as RecepcionAnalisis), valores: ((r as RecepcionAnalisis).valores ?? {}) }));
}

/** Siguiente N° de análisis de la colada (máximo + 1). */
export async function nextNColadaAnalisis(produccionId: string): Promise<number> {
  const { data } = await supabase.from(TABLE).select('n_analisis').eq('produccion_id', produccionId).order('n_analisis', { ascending: false }).limit(1).maybeSingle();
  return (num((data as { n_analisis?: number } | null)?.n_analisis) || 0) + 1;
}

export async function crearColadaAnalisis(
  produccionId: string,
  input: { n_analisis?: number | null; fecha?: string | null; valores?: Record<string, ValorMineral>; numeros?: string | null; procedencia?: string | null; nota?: string | null },
  actor: string, actorName?: string | null,
): Promise<RecepcionAnalisis> {
  const n = input.n_analisis != null && Number(input.n_analisis) > 0 ? Math.floor(Number(input.n_analisis)) : await nextNColadaAnalisis(produccionId);
  const { data, error } = await supabase.from(TABLE)
    .insert({ produccion_id: produccionId, n_analisis: n, fecha: input.fecha || new Date().toISOString(), valores: input.valores ?? {}, numeros: input.numeros?.trim() || null, procedencia: input.procedencia?.trim().toUpperCase() || null, nota: input.nota?.trim() || null, actor, actor_name: actorName ?? null })
    .select('*').single();
  if (error) throw error;
  return data as RecepcionAnalisis;
}

export async function actualizarColadaAnalisis(id: string, patch: { n_analisis?: number; fecha?: string; valores?: Record<string, ValorMineral>; numeros?: string | null; procedencia?: string | null; nota?: string | null }): Promise<void> {
  const p: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.n_analisis !== undefined) p.n_analisis = Math.floor(Number(patch.n_analisis) || 0);
  if (patch.fecha !== undefined) p.fecha = patch.fecha;
  if (patch.valores !== undefined) p.valores = patch.valores;
  if (patch.numeros !== undefined) p.numeros = patch.numeros?.trim() || null;
  if (patch.procedencia !== undefined) p.procedencia = patch.procedencia?.trim().toUpperCase() || null;
  if (patch.nota !== undefined) p.nota = patch.nota?.trim() || null;
  const { error } = await supabase.from(TABLE).update(p).eq('id', id);
  if (error) throw error;
}

export async function eliminarColadaAnalisis(id: string): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  if (error) throw error;
}
