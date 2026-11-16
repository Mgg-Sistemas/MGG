import { supabase } from '@/shared/lib/supabase';
import { todasLasFilas } from '@/shared/lib/todasLasFilas';
import { textoDeError } from '@/shared/lib/funcionesError';
import type { AccionesPapelera } from '@/shared/ui/PapeleraRegistros';

export async function cambiarPapeleraAsignacion(id: string, motivo?: string) {
  const { error } = await supabase.rpc('asignaciones_papelera_cambiar', { p_id: id, p_motivo: motivo });
  if (error) throw new Error(textoDeError(error, 'No se pudo actualizar la papelera de Asignaciones.'));
}

export const papeleraAsignaciones: AccionesPapelera = {
  modulo: 'asignaciones',
  titulo: 'Papelera de asignaciones y actas',
  listar: () => todasLasFilas<{ id: string; titulo: string; eliminado_en: string; eliminado_motivo: string }>((d, h) =>
    supabase.rpc('asignaciones_papelera_listar').range(d, h)),
  recuperar: cambiarPapeleraAsignacion,
  async vaciar(ids) {
    const { data, error } = await supabase.rpc('asignaciones_papelera_vaciar', { p_ids: ids });
    if (error) throw new Error(textoDeError(error, 'No se pudo vaciar la papelera de Asignaciones.'));
    return Number(data) || 0;
  },
  async hayAdjuntosPendientes() {
    const { data, error } = await supabase.from('asignaciones_adjuntos_por_vaciar').select('ruta').limit(1);
    if (error) throw new Error(textoDeError(error, 'No se pudo consultar la limpieza de adjuntos.'));
    return Boolean(data?.length);
  },
  async limpiarAdjuntos() {
    const filas = await todasLasFilas<{ ruta: string }>((d, h) =>
      supabase.from('asignaciones_adjuntos_por_vaciar').select('ruta').order('ruta').range(d, h));
    for (let i = 0; i < filas.length; i += 100) {
      const rutas = filas.slice(i, i + 100).map(({ ruta }) => ruta);
      const { error: storageError } = await supabase.storage.from('personal-docs').remove(rutas);
      if (storageError) throw new Error(textoDeError(storageError, 'No se pudieron limpiar los adjuntos de las actas.'));
      const { error } = await supabase.rpc('asignaciones_papelera_cerrar_limpieza', { p_rutas: rutas });
      if (error) throw new Error(textoDeError(error, 'No se pudo confirmar la limpieza.'));
    }
  },
};
