/* ============================================================
   MGG · Pedidos · Corregir el proveedor de una oferta YA ACEPTADA (29-10-2026).
   Editar la oferta permitía cambiarle el proveedor sin tocar la orden: la OC seguía a nombre
   del proveedor anterior y el historial no decía nada (caso SV-2026-0021, corregido a mano
   en la base). Ahora, si la oferta está aceptada, el cambio se lleva también a la orden que
   nació de ella (la madre, o la sub-OC de ese proveedor) con su evento «proveedor_cambiado»:
   de quién a quién (nombre y RIF de ese día), el motivo y quién lo hizo. La orden NO cambia
   de estado. Con la orden ya pagada, recibida (aunque sea en parte) o finalizada, el cambio
   se rechaza: el dinero o la mercancía ya se movieron a nombre del proveedor anterior.
   Una oferta que no está aceptada se sigue editando como siempre. Funciones puras.
   ============================================================ */

import { extrasCambioProveedor, MOTIVO_MIN, type ProveedorRef } from './cambioProveedor';
import type { EstadoOrden, EventoHistorial, ItemOrden } from '@/shared/lib/types';

/** Lo que hace falta de cada orden (la madre y sus sub-OC) para decidir. */
export interface OrdenDeOferta {
  id: string;
  codigo: string;
  oc_codigo?: string | null;
  estado: EstadoOrden;
  proveedor_id: string | null;
  parent_orden_id?: string | null;
  items?: ItemOrden[] | null;
  historial?: EventoHistorial[] | null;
}

/** Con la orden en estos estados ya hubo pago o recepción: el proveedor no se cambia. */
export const ESTADOS_SIN_CAMBIO_PROVEEDOR: EstadoOrden[] = ['pagada', 'recibida', 'finalizada'];

/** Órdenes que ya no cuentan: no se sincronizan ni bloquean. */
const ESTADOS_CERRADOS: EstadoOrden[] = ['anulada', 'cancelada', 'rechazada', 'desistida_proveedor', 'reasignada'];

const NOMBRE_ESTADO: Partial<Record<EstadoOrden, string>> = { pagada: 'pagada', recibida: 'recibida', finalizada: 'finalizada' };

export type DecisionCambioProveedor =
  /** No cambia el proveedor, o la oferta no está aceptada: se edita como siempre. */
  | { tipo: 'solo_oferta' }
  | { tipo: 'bloqueado'; mensaje: string }
  /** Oferta aceptada: también cambian estas órdenes (puede ser ninguna). */
  | { tipo: 'sincronizar'; ordenes: OrdenDeOferta[] };

const recibioAlgo = (o: OrdenDeOferta) => (o.items ?? []).some((it) => (Number(it.cantidad_recibida) || 0) > 0);

export function decidirCambioProveedor(
  oferta: { estado: string; proveedor_id: string },
  nuevoProveedorId: string | null | undefined,
  ordenes: OrdenDeOferta[],
): DecisionCambioProveedor {
  if (!nuevoProveedorId || nuevoProveedorId === oferta.proveedor_id || oferta.estado !== 'aceptada') return { tipo: 'solo_oferta' };
  // La orden de la oferta es la que está a nombre de su proveedor: la madre (un solo
  // proveedor) o la sub-OC de ese proveedor (multi-proveedor).
  const afectadas = ordenes.filter((o) => o.proveedor_id === oferta.proveedor_id && !ESTADOS_CERRADOS.includes(o.estado));
  for (const o of afectadas) {
    const doc = o.oc_codigo || o.codigo;
    if (ESTADOS_SIN_CAMBIO_PROVEEDOR.includes(o.estado)) {
      return { tipo: 'bloqueado', mensaje: `La orden ${doc} ya está ${NOMBRE_ESTADO[o.estado]}: el proveedor de su oferta aceptada ya no se puede cambiar.` };
    }
    if (recibioAlgo(o)) {
      return { tipo: 'bloqueado', mensaje: `La orden ${doc} ya tiene mercancía recibida: el proveedor de su oferta aceptada ya no se puede cambiar.` };
    }
  }
  return { tipo: 'sincronizar', ordenes: afectadas };
}

/** El motivo es obligatorio al cambiar el proveedor de una oferta aceptada. null si está bien. */
export function errorMotivoProveedorOferta(motivo: string | null | undefined): string | null {
  const m = (motivo ?? '').trim();
  if (!m) return 'Indique el motivo del cambio de proveedor: la oferta ya está aceptada y el cambio pasa a la orden.';
  if (m.length < MOTIVO_MIN) return `El motivo es muy corto (mínimo ${MOTIVO_MIN} letras).`;
  return null;
}

/** El evento «proveedor_cambiado» del historial de la orden. La orden no cambia de estado. */
export function eventoProveedorCambiado(a: {
  anterior: ProveedorRef | null; nuevo: ProveedorRef | null; motivo: string; actor: string; at?: string;
}): EventoHistorial {
  const extras = extrasCambioProveedor({ anterior: a.anterior, nuevo: a.nuevo, motivo: a.motivo });
  // extrasCambioProveedor es el del cambio desde «Editar OC», que devuelve la orden a
  // aprobación; aquí la orden sigue donde está.
  delete extras.vuelve_a;
  extras.desde = 'oferta_aceptada';
  return { at: a.at ?? new Date().toISOString(), evento: 'proveedor_cambiado', actor: a.actor, ...extras };
}
