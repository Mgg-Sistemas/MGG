/* ============================================================
   MGG · RRHH · Tabulador por cargo · acceso a la base (09-10-2026)

   Tablas: tabulador_cargos (una fila por cargo) y tabulador_cargos_historial
   (cada cambio). El monto, la vigencia y el estado se mueven SOLO por la RPC
   guardar_tabulador_cargo(): un update directo lo rechaza la base, para que no
   exista un cambio sin motivo ni historial.

   Aplicar el tabulador es la RPC aplicar_tabulador(): una sola transacción
   que llama a cambiar_sueldo_personal() por cada persona (mismo historial
   salarial `personal_sueldos`). Si una falla, no cambia ninguna.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { todasLasFilas } from '@/shared/lib/todasLasFilas';
import { aCentavos } from './cambioSueldo';
import type { FilaTabulador, HistorialTabulador } from './tabulador';

const TABLA = 'tabulador_cargos';
const TABLA_HIST = 'tabulador_cargos_historial';

function aFila(r: Record<string, unknown>): FilaTabulador {
  return {
    id: String(r.id),
    cargo: String(r.cargo ?? ''),
    sueldoBase: Number(r.sueldo_base) || 0,
    vigenteDesde: String(r.vigente_desde ?? '').slice(0, 10),
    activo: Boolean(r.activo),
    updatedAt: String(r.updated_at ?? ''),
    actualizadoPor: (r.actualizado_por as string) ?? null,
    actualizadoPorNombre: (r.actualizado_por_nombre as string) ?? null,
  };
}

function aHistorial(r: Record<string, unknown>): HistorialTabulador {
  return {
    id: String(r.id),
    tabuladorId: (r.tabulador_id as string) ?? null,
    cargo: String(r.cargo ?? ''),
    accion: String(r.accion ?? 'cambio'),
    sueldoAnterior: Number(r.sueldo_anterior) || 0,
    sueldoNuevo: Number(r.sueldo_nuevo) || 0,
    vigenteDesde: r.vigente_desde ? String(r.vigente_desde).slice(0, 10) : null,
    motivo: String(r.motivo ?? ''),
    cambiadoPor: (r.cambiado_por as string) ?? null,
    cambiadoPorNombre: (r.cambiado_por_nombre as string) ?? null,
    createdAt: String(r.created_at ?? ''),
  };
}

/** Todo el tabulador, activos e inactivos, por cargo. */
export async function listTabulador(): Promise<FilaTabulador[]> {
  const filas = await todasLasFilas<Record<string, unknown>>((d, h) =>
    supabase.from(TABLA).select('*').order('cargo', { ascending: true }).range(d, h));
  return filas.map(aFila);
}

export interface GuardarTabuladorOpts {
  cargo: string;
  sueldoBase: number;
  vigenteDesde?: string | null;
  motivo: string;
  activo?: boolean;
  actor?: string | null;
  actorName?: string | null;
}

/** Alta o cambio de una fila. La base escribe el historial en la misma transacción. */
export async function guardarFilaTabulador(o: GuardarTabuladorOpts): Promise<FilaTabulador> {
  const { data, error } = await supabase.rpc('guardar_tabulador_cargo', {
    p_cargo: o.cargo.trim(),
    p_sueldo: aCentavos(o.sueldoBase),
    p_vigente_desde: o.vigenteDesde || null,
    p_motivo: o.motivo.trim(),
    p_activo: o.activo ?? true,
    p_actor: o.actor ?? null,
    p_actor_name: o.actorName ?? null,
  });
  if (error) throw new Error(error.message || 'No se pudo guardar el tabulador.');
  return aFila(data as Record<string, unknown>);
}

/** El historial completo del tabulador, del cambio más nuevo al más viejo. */
export async function listHistorialTabulador(): Promise<HistorialTabulador[]> {
  const filas = await todasLasFilas<Record<string, unknown>>((d, h) =>
    supabase.from(TABLA_HIST).select('*')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(d, h));
  return filas.map(aHistorial);
}

export interface ResultadoAplicarTabulador {
  cambiados: number;
  sinCambio: number;
  vigenteDesde: string;
  motivo: string;
  detalle: Array<{ personal_id: string; nombre: string; apellido: string; cedula: string | null; cargo: string; anterior: number; nuevo: number }>;
}

/** Aplica el tabulador a todo el personal activo. Todo o nada. */
export async function aplicarTabulador(vigenteDesde: string, actor?: string | null, actorName?: string | null): Promise<ResultadoAplicarTabulador> {
  const { data, error } = await supabase.rpc('aplicar_tabulador', {
    p_vigente_desde: vigenteDesde || null,
    p_actor: actor ?? null,
    p_actor_name: actorName ?? null,
  });
  if (error) throw new Error(error.message || 'No se pudo aplicar el tabulador.');
  const r = (data ?? {}) as Record<string, unknown>;
  return {
    cambiados: Number(r.cambiados) || 0,
    sinCambio: Number(r.sin_cambio) || 0,
    vigenteDesde: String(r.vigente_desde ?? '').slice(0, 10),
    motivo: String(r.motivo ?? ''),
    detalle: (Array.isArray(r.detalle) ? r.detalle : []) as ResultadoAplicarTabulador['detalle'],
  };
}
