/* ============================================================
   MGG · Tesorería · Categorías y subcategorías de GASTO
   Catálogo jerárquico (categoría → subcategoría) que el registro de
   gasto exige (ambas obligatorias). Dinámico: se administra desde la
   app (agregar/renombrar/activar) y las listas son buscables.
   Tabla `categorias_gasto`: padre_id NULL = categoría; con padre = subcategoría.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';

export interface CategoriaGasto {
  id: string;
  nombre: string;
  padre_id: string | null;
  activo: boolean;
  actor?: string | null;
  created_at: string;
}

const TABLE = 'categorias_gasto';

/** Todas las filas (categorías + subcategorías), ordenadas por nombre. */
export async function listCategoriasGasto(soloActivas = true): Promise<CategoriaGasto[]> {
  let q = supabase.from(TABLE).select('*').order('nombre', { ascending: true });
  if (soloActivas) q = q.eq('activo', true);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as CategoriaGasto[];
}

/** Solo las categorías (padre_id null). */
export function soloCategorias(rows: CategoriaGasto[]): CategoriaGasto[] {
  return rows.filter((r) => r.padre_id == null);
}

/** Subcategorías de una categoría. */
export function subcategoriasDe(rows: CategoriaGasto[], categoriaId: string): CategoriaGasto[] {
  return rows.filter((r) => r.padre_id === categoriaId);
}

/**
 * Crea una categoría (padreId null) o subcategoría (padreId seteado) si no existe.
 * Devuelve la fila (existente o nueva). Idempotente por (nombre, padre).
 */
export async function ensureCategoriaGasto(nombre: string, padreId: string | null, actorEmail?: string | null): Promise<CategoriaGasto> {
  const n = nombre.trim();
  if (!n) throw new Error('El nombre es obligatorio.');
  // ¿Ya existe?
  let q = supabase.from(TABLE).select('*').ilike('nombre', n);
  q = padreId == null ? q.is('padre_id', null) : q.eq('padre_id', padreId);
  const { data: ex } = await q.maybeSingle();
  if (ex) return ex as CategoriaGasto;
  const { data, error } = await supabase.from(TABLE)
    .insert({ nombre: n, padre_id: padreId, actor: actorEmail ?? null })
    .select('*').single();
  if (error) {
    // Si chocó por unicidad (carrera), devolvemos la existente.
    let r = supabase.from(TABLE).select('*').ilike('nombre', n);
    r = padreId == null ? r.is('padre_id', null) : r.eq('padre_id', padreId);
    const { data: again } = await r.maybeSingle();
    if (again) return again as CategoriaGasto;
    throw error;
  }
  return data as CategoriaGasto;
}

export async function renombrarCategoriaGasto(id: string, nombre: string): Promise<void> {
  const n = nombre.trim();
  if (!n) throw new Error('El nombre es obligatorio.');
  const { error } = await supabase.from(TABLE).update({ nombre: n }).eq('id', id);
  if (error) throw error;
}

/** Activa/desactiva (no borra para no perder histórico de gastos ya etiquetados). */
export async function setActivoCategoriaGasto(id: string, activo: boolean): Promise<void> {
  const { error } = await supabase.from(TABLE).update({ activo }).eq('id', id);
  if (error) throw error;
}

/** Borra definitivamente (y por cascada sus subcategorías). Usar con cuidado. */
export async function eliminarCategoriaGasto(id: string): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  if (error) throw error;
}
