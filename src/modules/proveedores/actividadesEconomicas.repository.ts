import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/shared/lib/supabase';
import { useRealtime } from '@/shared/lib/useRealtime';
import { normalizarCodigoActividad, ordenarActividades, type ActividadEconomica } from './actividadesEconomicas';

const TABLE = 'actividades_economicas';

function esColumnaTipoInexistente(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  if (e.code === '42703' || e.code === 'PGRST204') return true;
  return /column .*tipo.* does not exist|could not find the 'tipo' column/i.test(e.message ?? '');
}

export async function listActividades(): Promise<ActividadEconomica[]> {
  const { data, error } = await supabase.from(TABLE).select('codigo, descripcion, tipo, activa').order('codigo');
  if (error) {
    if (esColumnaTipoInexistente(error)) {
      const alt = await supabase.from(TABLE).select('codigo, descripcion, activa').order('codigo');
      if (alt.error) throw alt.error;
      const filas = ((alt.data ?? []) as { codigo: string; descripcion: string; activa?: boolean }[]).map((r) => ({
        codigo: r.codigo,
        descripcion: r.descripcion,
        tipo: (String(r.codigo ?? '').includes('-') ? 'seccion' : 'actividad') as ActividadEconomica['tipo'],
        activa: r.activa !== false,
      }));
      return ordenarActividades(filas);
    }
    throw error;
  }
  return ordenarActividades((data ?? []) as ActividadEconomica[]);
}

/** Agrega una actividad al catálogo (Compras o Proveedores). Devuelve la creada. */
export async function crearActividad(codigoRaw: string, descripcion: string): Promise<ActividadEconomica> {
  const codigo = normalizarCodigoActividad(codigoRaw);
  if (!codigo) throw new Error('Código CIIU no válido.');
  const tipoDerivado: ActividadEconomica['tipo'] = codigo.includes('-') ? 'seccion' : 'actividad';
  const { data, error } = await supabase
    .from(TABLE)
    .insert({ codigo, descripcion: descripcion.trim(), tipo: tipoDerivado })
    .select('codigo, descripcion, tipo, activa')
    .single();
  if (error) {
    if (esColumnaTipoInexistente(error)) {
      const alt = await supabase
        .from(TABLE)
        .insert({ codigo, descripcion: descripcion.trim() })
        .select('codigo, descripcion, activa')
        .single();
      if (alt.error) {
        if (alt.error.code === '23505') throw new Error(`El código ${codigo} ya existe en el catálogo.`);
        if (alt.error.code === '42501') throw new Error('No tienes permiso para agregar actividades económicas.');
        throw new Error(alt.error.message || 'No se pudo agregar la actividad.');
      }
      const d = alt.data as { codigo: string; descripcion: string; activa?: boolean };
      return { codigo: d.codigo, descripcion: d.descripcion, tipo: tipoDerivado, activa: d.activa !== false };
    }
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
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883' || /could not find the function|function .* does not exist/i.test(error.message ?? '')) {
      const alt = await supabase.rpc('proveedor_fijar_actividad', { p_proveedor: proveedorId, p_codigo: codigo });
      if (alt.error) throw new Error(alt.error.message || 'No se pudo guardar la actividad económica del proveedor.');
      return;
    }
    throw new Error(error.message || 'No se pudo guardar la actividad económica del proveedor.');
  }
}

/** Catálogo en vivo (Realtime): lo que agregue otro usuario aparece sin recargar. */
export function useActividadesEconomicas(): { actividades: ActividadEconomica[]; recargar: () => void } {
  const [actividades, setActividades] = useState<ActividadEconomica[]>([]);
  const recargar = useCallback(() => { listActividades().then(setActividades).catch(() => undefined); }, []);
  useEffect(recargar, [recargar]);
  useRealtime([TABLE], recargar);
  return { actividades, recargar };
}
