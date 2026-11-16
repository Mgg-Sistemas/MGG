import { supabase } from '@/shared/lib/supabase';
import { todasLasFilas } from '@/shared/lib/todasLasFilas';
import { textoDeError } from '@/shared/lib/errores';
import type { AccionesPapelera } from '@/shared/ui/PapeleraRegistros';

export async function cambiarPapeleraAlmacen(id: string, motivo?: string, destino?: string | null) {
  const { error } = await supabase.rpc('almacenes_papelera_cambiar', { p_id: id, p_motivo: motivo, p_destino: destino });
  if (error) throw new Error(textoDeError(error, 'No se pudo actualizar la papelera de almacenes.'));
}

function acciones(modulo: 'inventario' | 'deposito'): AccionesPapelera {
  return {
    modulo,
    titulo: 'Papelera de almacenes',
    listar: () => todasLasFilas<{ id: string; titulo: string; eliminado_en: string; eliminado_motivo: string }>((d, h) =>
      supabase.rpc('almacenes_papelera_listar', { p_modulo: modulo }).range(d, h)),
    recuperar: cambiarPapeleraAlmacen,
    async vaciar(ids) {
      const { data, error } = await supabase.rpc('almacenes_papelera_vaciar', { p_modulo: modulo, p_ids: ids });
      if (error) throw new Error(textoDeError(error, 'No se pudo vaciar la papelera de almacenes.'));
      return Number(data) || 0;
    },
  };
}

export const papeleraAlmacenes = { inventario: acciones('inventario'), deposito: acciones('deposito') };
