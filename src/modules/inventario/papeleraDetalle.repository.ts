import { supabase } from '@/shared/lib/supabase';
import { todasLasFilas } from '@/shared/lib/todasLasFilas';
import { textoDeError } from '@/shared/lib/errores';
import type { AccionesPapelera } from '@/shared/ui/PapeleraRegistros';

export async function cambiarPapeleraDetalle(id: string, motivo?: string) {
  const { error } = await supabase.rpc('inventario_detalle_papelera_cambiar', { p_id: id, p_motivo: motivo });
  if (error) throw new Error(textoDeError(error, 'No se pudo actualizar la papelera de casiterita.'));
}

export const papeleraDetalle: AccionesPapelera = {
  modulo: 'inventario',
  titulo: 'Papelera del detalle de casiterita',
  listar: () => todasLasFilas<{ id: string; titulo: string; eliminado_en: string; eliminado_motivo: string }>((d, h) =>
    supabase.rpc('inventario_detalle_papelera_listar').range(d, h)),
  recuperar: cambiarPapeleraDetalle,
  async vaciar(ids) {
    const { data, error } = await supabase.rpc('inventario_detalle_papelera_vaciar', { p_ids: ids });
    if (error) throw new Error(textoDeError(error, 'No se pudo vaciar la papelera de casiterita.'));
    return Number(data) || 0;
  },
};
