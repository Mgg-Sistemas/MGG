/* ============================================================
   MGG · RRHH · Administrativo (Fase 3)
   Vacaciones, permisos, utilidades/aguinaldos y notas del historial
   laboral por persona. (Sin prestaciones sociales.)
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import type { RrhhEvento } from '@/shared/lib/types';
import { EMPRESA_POR_DEFECTO, type Empresa } from './empresa';

const TABLE = 'rrhh_eventos';

/** Los eventos de UNA empresa. La empresa la hereda la fila de su persona. */
export async function listEventos(
  personalId?: string,
  tipo?: RrhhEvento['tipo'],
  empresa: Empresa = EMPRESA_POR_DEFECTO,
): Promise<RrhhEvento[]> {
  let q = supabase.from(TABLE).select('*').eq('empresa', empresa).order('created_at', { ascending: false });
  if (personalId) q = q.eq('personal_id', personalId);
  if (tipo) q = q.eq('tipo', tipo);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as RrhhEvento[];
}

export interface EventoInput {
  personal_id: string;
  tipo: RrhhEvento['tipo'];
  fecha_desde?: string | null;
  fecha_hasta?: string | null;
  dias?: number | null;
  monto?: number | null;
  descripcion?: string | null;
}

export async function crearEvento(input: EventoInput, actorEmail?: string, actorName?: string | null): Promise<RrhhEvento> {
  if (!input.personal_id) throw new Error('Indicá a quién corresponde.');
  const { data, error } = await supabase.from(TABLE).insert({
    personal_id: input.personal_id,
    tipo: input.tipo,
    fecha_desde: input.fecha_desde || null,
    fecha_hasta: input.fecha_hasta || null,
    dias: input.dias != null ? Number(input.dias) : null,
    monto: input.monto != null ? Math.round(Number(input.monto) * 100) / 100 : null,
    descripcion: input.descripcion?.trim() || null,
    creado_por: actorEmail ?? null,
    actor_name: actorName ?? null,
  }).select('*').single();
  if (error) throw error;
  return data as RrhhEvento;
}

export async function eliminarEvento(id: string): Promise<void> {
  const { data, error } = await supabase.from(TABLE).delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data || data.length === 0) throw new Error('No se pudo eliminar: sin permiso o ya no existía.');
}

/** Marca una vacación como procesada (ya enviada a Tesorería) y guarda el renglón. */
export async function marcarVacacionProcesada(id: string, renglonId: string): Promise<void> {
  const { error } = await supabase.from(TABLE).update({ procesada: true, estado: 'procesada', nomina_renglon_id: renglonId }).eq('id', id);
  if (error) throw error;
}
