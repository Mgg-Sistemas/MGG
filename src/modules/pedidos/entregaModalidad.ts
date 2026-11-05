/* ============================================================
   MGG · Compras · ¿Quién entrega la orden? (04-11-2026)

   Al indicar el método de pago se elige cómo llega la mercancía, una vez pagada:
     · delivery      → va a la vista de Delivery (motorizados).
     · carga_pesada  → va a Carga pesada (otra flota, otro rol; mismo flujo que Delivery).
     · proveedor     → «Con entrega a domicilio»: la trae el proveedor; no va a ninguna.
   Una orden sin dato (las de antes) se trata como delivery.
   ============================================================ */
import type { EntregaModalidad, Orden } from '@/shared/lib/types';

export type { EntregaModalidad };
/** Las dos flotas que toman pedidos. */
export type Flota = 'delivery' | 'carga_pesada';

export const OPCIONES_ENTREGA: { value: EntregaModalidad; label: string; icono: string; ayuda: string }[] = [
  { value: 'delivery', label: 'Delivery', icono: '🛵', ayuda: 'Una vez pagada, la orden va a la vista de Delivery.' },
  { value: 'carga_pesada', label: 'Carga pesada', icono: '🚚', ayuda: 'Una vez pagada, va a Carga pesada (la ven solo los de carga pesada).' },
  { value: 'proveedor', label: 'Con entrega a domicilio', icono: '🏠', ayuda: 'El proveedor hace la entrega: no va a Delivery ni a Carga pesada.' },
];

/** La modalidad de una orden (las de antes, sin dato, son delivery). */
export function entregaDe(o: Pick<Orden, 'entrega_modalidad'>): EntregaModalidad {
  return o.entrega_modalidad ?? 'delivery';
}

export function etiquetaEntrega(m: EntregaModalidad | null | undefined): string {
  const op = OPCIONES_ENTREGA.find((x) => x.value === (m ?? 'delivery'));
  return op ? `${op.icono} ${op.label}` : '—';
}

/** ¿Esta orden pide decir quién entrega? Los servicios no se entregan y la contra entrega ya llegó. */
export function pideEntrega(o: Pick<Orden, 'clase' | 'condiciones_pago'>): boolean {
  return o.clase !== 'servicio' && o.condiciones_pago !== 'contra_entrega';
}

/** Nombre de la flota para la pantalla. */
export const NOMBRE_FLOTA: Record<Flota, string> = { delivery: 'Delivery', carga_pesada: 'Carga pesada' };
