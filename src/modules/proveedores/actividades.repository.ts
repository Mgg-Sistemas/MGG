/* ============================================================
   MGG · Proveedores · Catálogo de actividades económicas (actividades_economicas)
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { todasLasFilas } from '@/shared/lib/todasLasFilas';
import { normalizarCodigoCiiu, type ActividadEconomica } from './ciiu';

const TABLA = 'actividades_economicas';

interface Fila { codigo: string; descripcion: string; activa: boolean | null }

/** Todo el catálogo (activas e inactivas), por código. */
export async function listActividades(): Promise<ActividadEconomica[]> {
  const filas = await todasLasFilas<Fila>((d, h) =>
    supabase.from(TABLA).select('codigo, descripcion, activa').order('codigo').range(d, h));
  return filas.map((f) => ({ codigo: f.codigo, descripcion: f.descripcion, activa: f.activa !== false }));
}

/** Agrega una actividad que no estaba en el catálogo. Devuelve la fila creada. */
export async function crearActividad(codigo: string, descripcion: string, actor: string, actorName: string | null): Promise<ActividadEconomica> {
  const c = normalizarCodigoCiiu(codigo);
  const { data, error } = await supabase.from(TABLA)
    .insert({ codigo: c, descripcion: descripcion.trim(), activa: true, actor, actor_name: actorName })
    .select('codigo, descripcion, activa').single();
  if (error) {
    if (error.code === '23505') throw new Error(`El código ${c} ya está en el catálogo.`);
    throw new Error(error.message);
  }
  const f = data as Fila;
  return { codigo: f.codigo, descripcion: f.descripcion, activa: f.activa !== false };
}

/** Fija la actividad económica de un proveedor (RPC: basta con Pedidos o Proveedores). */
export async function fijarActividadProveedor(proveedorId: string, codigo: string | null): Promise<void> {
  const { error } = await supabase.rpc('proveedor_fijar_actividad', { p_proveedor: proveedorId, p_codigo: codigo || null });
  if (error) throw new Error(error.message);
}

/**
 * Actividad económica como TEXTO LIBRE (14-10-2026): la que se escribe en la cotización
 * mientras la administración define el catálogo. Queda en la ficha del proveedor; RPC
 * para que alcance con el permiso de Pedidos.
 */
export async function fijarActividadTextoProveedor(proveedorId: string, texto: string | null): Promise<void> {
  const { error } = await supabase.rpc('proveedor_fijar_actividad_texto', { p_proveedor: proveedorId, p_texto: texto?.trim() || null });
  if (error) throw new Error(error.message);
}
