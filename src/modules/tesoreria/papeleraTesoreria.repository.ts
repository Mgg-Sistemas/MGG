import { supabase } from '@/shared/lib/supabase';
import { todasLasFilas } from '@/shared/lib/todasLasFilas';
import { textoDeError } from '@/shared/lib/errores';
import type { AccionesPapelera } from '@/shared/ui/PapeleraRegistros';

export async function cambiarPapeleraTesoreria(id: string, motivo?: string) {
  const { error } = await supabase.rpc('tesoreria_papelera_cambiar', { p_id: id, p_motivo: motivo });
  if (error) throw new Error(textoDeError(error, 'No se pudo actualizar la papelera de Tesorería.'));
}

export const papeleraTesoreria: AccionesPapelera = {
  modulo: 'tesoreria',
  titulo: 'Papelera de movimientos de Tesorería',
  listar: () => todasLasFilas<{ id: string; titulo: string; eliminado_en: string; eliminado_motivo: string }>((d, h) =>
    supabase.rpc('tesoreria_papelera_listar').range(d, h)),
  recuperar: cambiarPapeleraTesoreria,
  async vaciar(ids) {
    const { data, error } = await supabase.rpc('tesoreria_papelera_vaciar', { p_ids: ids });
    if (error) throw new Error(textoDeError(error, 'No se pudo vaciar la papelera de Tesorería.'));
    return Number(data) || 0;
  },
};

export async function cambiarPapeleraCatalogoTesoreria(tabla: string, id: string, motivo?: string) {
  const { error } = await supabase.rpc('tesoreria_catalogo_papelera_cambiar', { p_tabla: tabla, p_id: id, p_motivo: motivo });
  if (error) throw new Error(textoDeError(error, 'No se pudo actualizar la papelera del catálogo.'));
}

export const papeleraCatalogosTesoreria: AccionesPapelera = {
  modulo: 'tesoreria',
  titulo: 'Papelera de categorías y contrapartes',
  listar: () => todasLasFilas<{ id: string; titulo: string; eliminado_en: string; eliminado_motivo: string }>((d, h) =>
    supabase.rpc('tesoreria_catalogo_papelera_listar').range(d, h)),
  async recuperar(id) {
    const [tabla, filaId] = id.split(':');
    await cambiarPapeleraCatalogoTesoreria(tabla, filaId);
  },
  async vaciar(ids) {
    const { data, error } = await supabase.rpc('tesoreria_catalogo_papelera_vaciar', { p_ids: ids });
    if (error) throw new Error(textoDeError(error, 'No se pudo vaciar la papelera del catálogo.'));
    return Number(data) || 0;
  },
};
