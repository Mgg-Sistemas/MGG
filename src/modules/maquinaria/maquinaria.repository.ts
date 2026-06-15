/* ============================================================
   MGG · Control de Maquinaria · catálogos (Supabase)
   Catálogo gestionable en 2 partes: TIPO DE MAQUINARIA y PROPIETARIO.
   Mismo patrón que el catálogo de la OP (pedido_catalogos): listar,
   agregar, editar, activar/desactivar y eliminar. En vivo (Realtime).
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';

export type TipoCatalogoMaquinaria = 'tipo_maquinaria' | 'propietario' | 'status';

export interface CatalogoMaquinaria {
  id: string;
  tipo: TipoCatalogoMaquinaria;
  valor: string;
  activo: boolean;
  orden: number;
  created_at: string;
}

const TABLE = 'maquinaria_catalogos';

export async function listCatalogosMaquinaria(tipo?: TipoCatalogoMaquinaria): Promise<CatalogoMaquinaria[]> {
  let q = supabase.from(TABLE).select('*')
    .order('orden', { ascending: true })
    .order('valor', { ascending: true });
  if (tipo) q = q.eq('tipo', tipo);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as CatalogoMaquinaria[];
}

/** Solo los valores ACTIVOS de un tipo (para selectores). */
export async function listActivosMaquinaria(tipo: TipoCatalogoMaquinaria): Promise<string[]> {
  const { data, error } = await supabase.from(TABLE).select('valor')
    .eq('tipo', tipo).eq('activo', true)
    .order('orden', { ascending: true })
    .order('valor', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => (r as { valor: string }).valor);
}

export async function addCatalogoMaquinaria(tipo: TipoCatalogoMaquinaria, valor: string): Promise<CatalogoMaquinaria> {
  const v = valor.trim();
  if (!v) throw new Error('Indicá el valor.');
  const { data, error } = await supabase
    .from(TABLE)
    .insert({ tipo, valor: v, orden: 999 })
    .select('*')
    .single();
  if (error) {
    if ((error as { code?: string }).code === '23505') throw new Error('Ese valor ya existe en el catálogo.');
    throw error;
  }
  return data as CatalogoMaquinaria;
}

export async function updateCatalogoMaquinaria(id: string, valor: string): Promise<void> {
  const v = valor.trim();
  if (!v) throw new Error('Indicá el valor.');
  const { error } = await supabase.from(TABLE).update({ valor: v }).eq('id', id);
  if (error) {
    if ((error as { code?: string }).code === '23505') throw new Error('Ese valor ya existe en el catálogo.');
    throw error;
  }
}

export async function setCatalogoMaquinariaActivo(id: string, activo: boolean): Promise<void> {
  const { error } = await supabase.from(TABLE).update({ activo }).eq('id', id);
  if (error) throw error;
}

export async function eliminarCatalogoMaquinaria(id: string): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  if (error) throw error;
}
