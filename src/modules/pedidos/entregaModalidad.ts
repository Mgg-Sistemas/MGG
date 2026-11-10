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
  { value: 'delivery', label: 'Delivery', icono: '🛵', ayuda: 'Va a la vista de Delivery cuando Compras confirma el retiro.' },
  { value: 'carga_pesada', label: 'Carga pesada', icono: '🚚', ayuda: 'Va a Carga pesada (solo la ven los de carga pesada) cuando Compras confirma el retiro.' },
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

/** Desde aquí el delivery toma las OC pagadas (el mismo corte que usa la base). */
export const CORTE_DELIVERY_ISO = '2026-11-03T04:00:00.000Z';

/**
 * 06-11-2026: ¿la OC está en «Pendientes por recibir»? Pagada, sin recibir, de productos, y
 * Compras todavía no confirmó el retiro (ni quién entrega). Mientras tanto el delivery no la ve.
 * 10-11-2026: sin el corte del 03-11 (la confirmación de Compras es la puerta): una OC pagada antes,
 * como OC-2026-0201 (29-10), también se puede mandar al delivery. La base acepta lo confirmado.
 */
export function pendienteRetiro(o: Pick<Orden, 'estado' | 'clase' | 'condiciones_pago' | 'oc_codigo' | 'recibida_en' | 'pagada_en' | 'retiro_confirmado_en'>): boolean {
  return o.estado === 'pagada'
    && !o.recibida_en
    && !o.retiro_confirmado_en
    && !!o.oc_codigo
    && pideEntrega(o);
}
