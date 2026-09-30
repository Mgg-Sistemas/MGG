/* ============================================================
   Golden Touch · RRHH · Descansos por rotación (datos)

   rrhh_descansos        → un descanso de una persona (desde / hasta).
                           origen 'plan' = lo armó el generador; 'manual' = cargado a mano.
                           La base no deja que una persona tenga dos descansos cruzados.
   rrhh_descansos_config → días de trabajo, días de descanso y tope de personas
                           fuera a la vez, uno por nómina (en MGG hay una sola).
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import type { Empresa } from './empresa';
import { CONFIG_POR_DEFECTO, type ConfigDescansos, type DescansoRango } from './descansosPlan';

export interface Descanso extends DescansoRango {
  id: string;
  origen: 'plan' | 'manual';
  nota?: string | null;
  created_at: string;
  created_by?: string | null;
  actor_name?: string | null;
  updated_at?: string | null;
}

const TABLA = 'rrhh_descansos';
const TABLA_CFG = 'rrhh_descansos_config';

/** Descansos de esas personas (todas las fechas). */
export async function listDescansos(personalIds: string[]): Promise<Descanso[]> {
  if (!personalIds.length) return [];
  const out: Descanso[] = [];
  // En tandas: una lista larga de ids en la URL puede pasarse del límite.
  for (let i = 0; i < personalIds.length; i += 150) {
    const { data, error } = await supabase.from(TABLA).select('*')
      .in('personal_id', personalIds.slice(i, i + 150)).order('desde');
    if (error) throw error;
    out.push(...((data ?? []) as Descanso[]));
  }
  return out;
}

export async function getConfigDescansos(empresa: Empresa): Promise<ConfigDescansos> {
  const { data, error } = await supabase.from(TABLA_CFG).select('dias_trabajo, dias_descanso, max_simultaneos')
    .eq('empresa', empresa).maybeSingle();
  if (error) throw error;
  return (data as ConfigDescansos | null) ?? CONFIG_POR_DEFECTO;
}

export async function guardarConfigDescansos(empresa: Empresa, cfg: ConfigDescansos, actor: string): Promise<void> {
  const { error } = await supabase.from(TABLA_CFG)
    .upsert({ empresa, ...cfg, updated_at: new Date().toISOString(), updated_by: actor }, { onConflict: 'empresa' });
  if (error) throw error;
}

function mensaje(e: { message?: string } | null): Error {
  return new Error(e?.message || 'No se pudo guardar el descanso');
}

export async function crearDescanso(
  d: { personal_id: string; desde: string; hasta: string; nota?: string | null },
  actor: string, actorName: string | null,
): Promise<void> {
  const { error } = await supabase.from(TABLA).insert({
    ...d, nota: d.nota?.trim() || null, origen: 'manual', created_by: actor, actor_name: actorName,
  });
  if (error) throw mensaje(error);
}

/** Editar a mano un descanso lo vuelve 'manual': el generador ya no lo pisa. */
export async function editarDescanso(id: string, cambios: { desde: string; hasta: string; nota?: string | null }): Promise<void> {
  const { error } = await supabase.from(TABLA)
    .update({ ...cambios, nota: cambios.nota?.trim() || null, origen: 'manual' }).eq('id', id);
  if (error) throw mensaje(error);
}

export async function eliminarDescanso(id: string): Promise<void> {
  const { error } = await supabase.from(TABLA).delete().eq('id', id);
  if (error) throw error;
}

/* ── Selecciones guardadas (30-09-2026) ──────────────────────────────────
   Quiénes salen en un plan se elige a mano; la elección se guarda con un
   nombre («Cocina», «Turno A», «Galpón Los Pinos»…) para cargarla de un
   toque en el próximo descanso. */

export interface GrupoDescanso {
  id: string;
  nombre: string;
  personal_ids: string[];
  created_at: string;
  actor_name?: string | null;
}

const TABLA_GRUPOS = 'rrhh_descansos_grupos';

export async function listGruposDescanso(empresa: Empresa): Promise<GrupoDescanso[]> {
  const { data, error } = await supabase.from(TABLA_GRUPOS).select('id, nombre, personal_ids, created_at, actor_name')
    .eq('empresa', empresa).order('nombre');
  if (error) throw error;
  return (data ?? []) as GrupoDescanso[];
}

/** Guarda la selección con ese nombre; si el nombre ya existe, la reemplaza. */
export async function guardarGrupoDescanso(
  empresa: Empresa, nombre: string, personalIds: string[], actor: string, actorName: string | null,
): Promise<void> {
  const n = nombre.trim();
  if (!n) throw new Error('Poné un nombre a la selección.');
  if (!personalIds.length) throw new Error('La selección está vacía.');
  const { error } = await supabase.from(TABLA_GRUPOS).upsert({
    empresa, nombre: n, personal_ids: personalIds, created_by: actor, actor_name: actorName,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'empresa,nombre' });
  if (error) throw mensaje(error);
}

export async function eliminarGrupoDescanso(id: string): Promise<void> {
  const { error } = await supabase.from(TABLA_GRUPOS).delete().eq('id', id);
  if (error) throw error;
}

/**
 * Reemplaza el plan: borra los descansos 'plan' de esas personas desde `desde`
 * y guarda los nuevos, todo junto (si algo falla, queda el plan anterior).
 */
export async function aplicarPlanDescansos(
  personalIds: string[], desde: string, filas: DescansoRango[], actor: string, actorName: string | null,
): Promise<number> {
  const { data, error } = await supabase.rpc('rrhh_descansos_aplicar_plan', {
    p_personal_ids: personalIds, p_desde: desde, p_filas: filas, p_actor: actor, p_actor_name: actorName,
  });
  if (error) throw mensaje(error);
  return Number(data) || 0;
}
