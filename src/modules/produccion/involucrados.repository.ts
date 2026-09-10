/* ============================================================
   MGG · Catálogo de INVOLUCRADOS (Supabase)

   Se administra como los hornos: alta, edición (nombre y cargo) y baja
   con motivo, más reactivación. Los reportes de colada guardan el
   NOMBRE, no el id, para que un papel ya firmado no cambie de firmante
   cuando alguien se renombra acá.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { textoDeError } from '@/shared/lib/errores';
import { limpiarNombre } from './involucrados';
import type { Involucrado } from '@/shared/lib/types';

const TABLE = 'involucrados';

/** Todos (activos e inhabilitados), ordenados por nombre. */
export async function listInvolucrados(): Promise<Involucrado[]> {
  const { data, error } = await supabase.from(TABLE).select('*').order('nombre', { ascending: true });
  if (error) throw new Error(textoDeError(error, 'No se pudo leer el catálogo de involucrados.'));
  return (data ?? []) as Involucrado[];
}

/** Solo los ACTIVOS — para poblar el selector del formulario. */
export async function listInvolucradosActivos(): Promise<Involucrado[]> {
  const { data, error } = await supabase.from(TABLE).select('*').eq('estado', 'activo').order('nombre', { ascending: true });
  if (error) throw new Error(textoDeError(error, 'No se pudo leer el catálogo de involucrados.'));
  return (data ?? []) as Involucrado[];
}

const yaExiste = (e: unknown): boolean => (e as { code?: string })?.code === '23505';

export async function crearInvolucrado(nombre: string, cargo: string, actorEmail?: string): Promise<Involucrado> {
  const limpio = limpiarNombre(nombre);
  if (!limpio) throw new Error('El nombre de la persona es obligatorio.');
  const { data, error } = await supabase.from(TABLE)
    .insert({ nombre: limpio, cargo: cargo.trim() || null, created_by: actorEmail ?? null })
    .select('*').single();
  if (error) {
    if (yaExiste(error)) throw new Error(`«${limpio}» ya está en el catálogo.`);
    throw new Error(textoDeError(error, 'No se pudo agregar a la persona.'));
  }
  return data as Involucrado;
}

/** Cambia el nombre y/o el cargo. */
export async function editarInvolucrado(id: string, nombre: string, cargo: string): Promise<Involucrado> {
  const limpio = limpiarNombre(nombre);
  if (!limpio) throw new Error('El nombre no puede quedar vacío.');
  const { data, error } = await supabase.from(TABLE)
    .update({ nombre: limpio, cargo: cargo.trim() || null, updated_at: new Date().toISOString() })
    .eq('id', id).select('*').single();
  if (error) {
    if (yaExiste(error)) throw new Error(`«${limpio}» ya está en el catálogo.`);
    throw new Error(textoDeError(error, 'No se pudo guardar el cambio.'));
  }
  return data as Involucrado;
}

/** Desactiva a una persona guardando el MOTIVO (obligatorio). */
export async function desactivarInvolucrado(id: string, motivo: string): Promise<Involucrado> {
  const m = motivo.trim();
  if (!m) throw new Error('Indicá el motivo por el que se desactiva a la persona.');
  const { data, error } = await supabase.from(TABLE)
    .update({ estado: 'inactivo', motivo_inhabilitacion: m, updated_at: new Date().toISOString() })
    .eq('id', id).select('*').single();
  if (error) throw new Error(textoDeError(error, 'No se pudo desactivar a la persona.'));
  return data as Involucrado;
}

/** Reactiva a una persona desactivada (limpia el motivo). */
export async function reactivarInvolucrado(id: string): Promise<Involucrado> {
  const { data, error } = await supabase.from(TABLE)
    .update({ estado: 'activo', motivo_inhabilitacion: null, updated_at: new Date().toISOString() })
    .eq('id', id).select('*').single();
  if (error) throw new Error(textoDeError(error, 'No se pudo reactivar a la persona.'));
  return data as Involucrado;
}
