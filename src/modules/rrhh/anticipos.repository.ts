/* ============================================================
   MGG · RRHH · Anticipos y préstamos (deducciones con saldo)
   Se registran por persona y se descuentan por cuotas en la nómina
   hasta saldar. El saldo se reduce cuando el renglón se PAGA en Tesorería.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import type { AnticipoPrestamo } from '@/shared/lib/types';
import { EMPRESA_POR_DEFECTO, type Empresa } from './empresa';

const TABLE = 'anticipos_prestamos';

/** Los anticipos de la nómina. La empresa la hereda la fila de su persona. */
export async function listAnticipos(
  personalId?: string,
  soloActivos = false,
  empresa: Empresa = EMPRESA_POR_DEFECTO,
): Promise<AnticipoPrestamo[]> {
  let q = supabase.from(TABLE).select('*').eq('empresa', empresa).order('created_at', { ascending: false });
  if (personalId) q = q.eq('personal_id', personalId);
  if (soloActivos) q = q.eq('estado', 'activo');
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as AnticipoPrestamo[];
}

/**
 * Activos con saldo > 0, para armar la nómina. El filtro por empresa quedó
 * de cuando había dos: hoy trae lo mismo, pero es la pieza que habría que
 * mantener si volviera una segunda nómina.
 */
export async function listAnticiposActivos(empresa: Empresa = EMPRESA_POR_DEFECTO): Promise<AnticipoPrestamo[]> {
  const { data, error } = await supabase.from(TABLE).select('*')
    .eq('empresa', empresa).eq('estado', 'activo').gt('saldo', 0)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as AnticipoPrestamo[];
}

export interface AnticipoInput {
  personal_id: string;
  tipo: 'anticipo' | 'prestamo';
  monto_total: number;
  cuota_sugerida?: number | null;
  motivo?: string | null;
}

export async function crearAnticipo(input: AnticipoInput, actorEmail?: string, actorName?: string | null): Promise<AnticipoPrestamo> {
  const monto = Math.round((Number(input.monto_total) || 0) * 100) / 100;
  if (!input.personal_id) throw new Error('Indicá a quién corresponde.');
  if (monto <= 0) throw new Error('El monto debe ser mayor que 0.');
  const { data, error } = await supabase.from(TABLE).insert({
    personal_id: input.personal_id,
    tipo: input.tipo,
    monto_total: monto,
    saldo: monto,
    cuota_sugerida: input.cuota_sugerida != null ? Math.round(Number(input.cuota_sugerida) * 100) / 100 : null,
    motivo: input.motivo?.trim() || null,
    creado_por: actorEmail ?? null,
    actor_name: actorName ?? null,
  }).select('*').single();
  if (error) throw error;
  return data as AnticipoPrestamo;
}

/** Descuenta `monto` del saldo (al pagar un renglón). Marca saldado si llega a 0. */
export async function descontarSaldo(id: string, monto: number): Promise<void> {
  const { data, error } = await supabase.from(TABLE).select('saldo').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return;
  const nuevo = Math.max(0, Math.round(((Number(data.saldo) || 0) - (Number(monto) || 0)) * 100) / 100);
  const { error: uErr } = await supabase.from(TABLE).update({ saldo: nuevo, estado: nuevo <= 0 ? 'saldado' : 'activo' }).eq('id', id);
  if (uErr) throw uErr;
}

export async function eliminarAnticipo(id: string): Promise<void> {
  const { data, error } = await supabase.from(TABLE).delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data || data.length === 0) throw new Error('No se pudo eliminar: sin permiso o ya no existía.');
}
