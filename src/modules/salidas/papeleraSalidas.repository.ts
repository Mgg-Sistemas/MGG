import { supabase } from '@/shared/lib/supabase';
import { todasLasFilas } from '@/shared/lib/todasLasFilas';
import { textoDeError } from '@/shared/lib/funcionesError';
import type { AccionesPapelera } from '@/shared/ui/PapeleraRegistros';

type Tabla = 'solicitudes_salida_temporal' | 'salidas_choferes' | 'salidas_vehiculos';
export const BUCKET_SALIDAS_ADJUNTOS = 'salidas-adjuntos';

async function cambiar(tabla: string, id: string, motivo?: string) {
  const { error } = await supabase.rpc('salidas_papelera_cambiar', { p_tabla: tabla, p_id: id, p_motivo: motivo });
  if (error) throw new Error(textoDeError(error, 'No se pudo actualizar la papelera de Salidas.'));
}

export function archivarSalida(tabla: Tabla, id: string, motivo: string) {
  return cambiar(tabla, id, motivo);
}

export const papeleraSalidas: AccionesPapelera = {
  modulo: 'salidas',
  titulo: 'Papelera de Salidas',
  listar: () => todasLasFilas<{ id: string; titulo: string; eliminado_en: string; eliminado_motivo: string }>((d, h) =>
    supabase.rpc('salidas_papelera_listar').range(d, h)),
  async recuperar(id) {
    const [tabla, filaId] = id.split(':');
    await cambiar(tabla, filaId);
  },
  async vaciar(ids) {
    const { data, error } = await supabase.rpc('salidas_papelera_vaciar', { p_ids: ids });
    if (error) throw new Error(textoDeError(error, 'No se pudo vaciar la papelera de Salidas.'));
    return Number(data) || 0;
  },
  async hayAdjuntosPendientes() {
    const { data, error } = await supabase.from('salidas_adjuntos_por_vaciar').select('ruta').limit(1);
    if (error) throw new Error(textoDeError(error, 'No se pudo consultar la limpieza de adjuntos.'));
    return Boolean(data?.length);
  },
  async limpiarAdjuntos() {
    const filas = await todasLasFilas<{ ruta: string }>((d, h) =>
      supabase.from('salidas_adjuntos_por_vaciar').select('ruta').order('ruta').range(d, h));
    for (let i = 0; i < filas.length; i += 100) {
      const rutas = filas.slice(i, i + 100).map(({ ruta }) => ruta);
      const { error: storageError } = await supabase.storage.from(BUCKET_SALIDAS_ADJUNTOS).remove(rutas);
      if (storageError) throw new Error(textoDeError(storageError, 'No se pudieron limpiar los adjuntos.'));
      const { error } = await supabase.rpc('salidas_papelera_cerrar_limpieza', { p_rutas: rutas });
      if (error) throw new Error(textoDeError(error, 'No se pudo confirmar la limpieza.'));
    }
  },
};
