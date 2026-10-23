import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/shared/lib/supabase';
import { useRealtime } from '@/shared/lib/useRealtime';
import { normalizarCodigoActividad, ordenarActividades, type ActividadEconomica } from './actividadesEconomicas';

const TABLE = 'actividades_economicas';

export async function listActividades(): Promise<ActividadEconomica[]> {
  const { data, error } = await supabase.from(TABLE).select('codigo, descripcion, tipo, activa').order('codigo');
  if (error) throw error;
  return ordenarActividades((data ?? []) as ActividadEconomica[]);
}

/** Agrega una actividad al catálogo (Compras o Proveedores). Devuelve la creada. */
export async function crearActividad(codigoRaw: string, descripcion: string): Promise<ActividadEconomica> {
  const codigo = normalizarCodigoActividad(codigoRaw);
  if (!codigo) throw new Error('Código CIIU no válido.');
  const { data, error } = await supabase
    .from(TABLE)
    .insert({ codigo, descripcion: descripcion.trim(), tipo: codigo.includes('-') ? 'seccion' : 'actividad' })
    .select('codigo, descripcion, tipo, activa')
    .single();
  if (error) {
    if (error.code === '23505') throw new Error(`El código ${codigo} ya existe en el catálogo.`);
    if (error.code === '42501') throw new Error('No tienes permiso para agregar actividades económicas.');
    throw new Error(error.message || 'No se pudo agregar la actividad.');
  }
  return data as ActividadEconomica;
}

/** Fija la actividad económica en la ficha del proveedor. Va por RPC porque quien
 *  registra la cotización (Compras) puede no tener permiso de escritura en Proveedores. */
export async function fijarActividadProveedor(proveedorId: string, codigo: string | null): Promise<void> {
  const { error } = await supabase.rpc('proveedor_fijar_actividad', { p_proveedor_id: proveedorId, p_codigo: codigo });
  if (error) throw new Error(error.message || 'No se pudo guardar la actividad económica del proveedor.');
}

/** Catálogo en vivo (Realtime): lo que agregue otro usuario aparece sin recargar. */
export function useActividadesEconomicas(): { actividades: ActividadEconomica[]; recargar: () => void } {
  const [actividades, setActividades] = useState<ActividadEconomica[]>([]);
  const recargar = useCallback(() => { listActividades().then(setActividades).catch(() => undefined); }, []);
  useEffect(recargar, [recargar]);
  useRealtime([TABLE], recargar);
  return { actividades, recargar };
}
