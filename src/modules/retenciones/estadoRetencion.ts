/* ============================================================
   Golden Touch · Retenciones · Estado de retención de una factura/orden

   FUENTE ÚNICA de la verdad para los badges («Retenida / Parcial / No retenida»)
   y para el mensaje de WhatsApp. No se inventan tres definiciones: todo sale de
   aquí.

   El estado compara los impuestos que la empresa DEBE retener (aplicables) con
   los que ya tienen retención (hechas). Para una orden, los «aplicables» y los
   «hechas» los arma el adaptador reutilizando lo que ya calcula el módulo
   (impuestosPendientesDeOrden, registradas del libro, los paths de la OC y
   retencion_finalizada). Para una factura del buzón, su propio estatus.

   El estado de pago (¿Tesorería pagó?) viaja junto al estado de retención,
   porque en pantalla y en el mensaje van juntos.
   ============================================================ */
import type { Orden } from '@/shared/lib/types';
import { TIPOS_IMPUESTO, type TipoImpuesto } from '@/modules/libroFiscal/retencionesCalculo';

export type EstadoRetencion = 'retenida' | 'parcial' | 'no_retenida' | 'no_aplica';

export interface ResumenRetencion {
  estado: EstadoRetencion;
  /** Lo que la empresa debe retener de esta factura/orden. */
  aplicables: TipoImpuesto[];
  /** De lo aplicable, lo que ya tiene retención. */
  hechas: TipoImpuesto[];
  /** De lo aplicable, lo que falta retener. */
  faltantes: TipoImpuesto[];
  /** ¿Tesorería pagó la factura? */
  pagada: boolean;
  /** Si está pagada, el monto con que se canceló (solo lectura del modelo de la OC). */
  montoPagado?: number | null;
  /** La moneda de ese monto. */
  monedaPago?: string | null;
}

const montoVe = (n: number) => Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** El texto del estado de pago: «✓ Pagada», «✓ Pagada: Bs X» o «Por pagar». */
export function textoPago(r: Pick<ResumenRetencion, 'pagada' | 'montoPagado' | 'monedaPago'>): string {
  if (!r.pagada) return 'Por pagar';
  if (r.montoPagado != null && r.montoPagado > 0) {
    const mon = r.monedaPago === 'Bs' ? 'Bs' : '$';
    return `✓ Pagada: ${mon} ${montoVe(r.montoPagado)}`;
  }
  return '✓ Pagada';
}

/** El rótulo corto de un impuesto (IVA, ISLR, ISAE…), para badges y mensajes. */
export function rotuloCortoImpuesto(t: TipoImpuesto): string {
  return TIPOS_IMPUESTO.find((x) => x.key === t)?.corto ?? t.toUpperCase();
}

/**
 * El estado a partir de los impuestos aplicables y los ya hechos. Es la única
 * definición: todos los badges y el mensaje de WhatsApp pasan por aquí.
 */
export function estadoRetencion(
  aplicables: readonly TipoImpuesto[],
  hechas: readonly TipoImpuesto[],
  pagada = false,
): ResumenRetencion {
  const aplic = [...new Set(aplicables)];
  const hechasDeAplic = aplic.filter((t) => hechas.includes(t));
  const faltantes = aplic.filter((t) => !hechas.includes(t));
  let estado: EstadoRetencion;
  if (aplic.length === 0) estado = 'no_aplica';
  else if (faltantes.length === 0) estado = 'retenida';
  else if (hechasDeAplic.length === 0) estado = 'no_retenida';
  else estado = 'parcial';
  return { estado, aplicables: aplic, hechas: hechasDeAplic, faltantes, pagada };
}

export interface BadgeRetencion { label: string; className: string; tooltip: string; }

/** El badge visual del estado de retención (mismas clases que el resto del kanban). */
export function badgeEstadoRetencion(r: ResumenRetencion): BadgeRetencion {
  const faltan = r.faltantes.map(rotuloCortoImpuesto).join(', ');
  const hechas = r.hechas.map(rotuloCortoImpuesto).join(', ');
  switch (r.estado) {
    case 'retenida':
      return { label: '✓ Retenida', className: 'badge success', tooltip: hechas ? `Retención hecha: ${hechas}` : 'Retención hecha' };
    case 'parcial':
      return { label: 'Retención parcial', className: 'badge warning', tooltip: `Hecha: ${hechas || '—'} · Falta: ${faltan || '—'}` };
    case 'no_retenida':
      return { label: 'No retenida', className: 'badge danger', tooltip: faltan ? `Falta retener: ${faltan}` : 'Sin retención' };
    default:
      return { label: 'Sin retención', className: 'badge', tooltip: 'Esta factura no lleva retención' };
  }
}

/* ───────── Adaptador: una ORDEN (flujo de Compras/Retenciones) ───────── */

/** Los impuestos de la OC que se controlan con paths propios. */
const TIPOS_OC: TipoImpuesto[] = ['iva', 'islr', 'municipal'];

type OrdenConRetencion = Pick<Orden,
  'retencion_iva_path' | 'retencion_islr_path' | 'retencion_municipal_path' | 'retencion_finalizada' | 'retencion_pagada'>;

/** Los impuestos que YA tienen retención en la orden: los del libro (reg) y los de los paths de la OC. */
export function impuestosHechosDeOrden(o: OrdenConRetencion, reg?: Set<TipoImpuesto> | null): TipoImpuesto[] {
  const hechas = new Set<TipoImpuesto>(reg ? [...reg] : []);
  if (o.retencion_iva_path) hechas.add('iva');
  if (o.retencion_islr_path) hechas.add('islr');
  if (o.retencion_municipal_path) hechas.add('municipal');
  return TIPOS_OC.filter((t) => hechas.has(t));
}

/**
 * El estado de retención de una orden. `faltantes` es lo que ya calcula
 * `impuestosPendientesDeOrden` (aplicable y aún no hecho); `reg` es el conjunto
 * de impuestos registrados para esa orden (registradas del libro + «no aplica»).
 * Si la retención está finalizada, manda ese hecho: queda «retenida».
 */
export function estadoRetencionDeOrden(
  o: OrdenConRetencion,
  faltantes: readonly TipoImpuesto[],
  reg?: Set<TipoImpuesto> | null,
  pago?: { monto: number | null; moneda: string | null } | null,
): ResumenRetencion {
  const hechas = impuestosHechosDeOrden(o, reg);
  const pagada = !!o.retencion_pagada;
  const conPago = (r: ResumenRetencion): ResumenRetencion =>
    (pagada && pago ? { ...r, montoPagado: pago.monto, monedaPago: pago.moneda } : r);
  if (o.retencion_finalizada) {
    return conPago({ estado: 'retenida', aplicables: hechas, hechas, faltantes: [], pagada });
  }
  const aplicables = [...new Set<TipoImpuesto>([...hechas, ...faltantes])];
  return conPago(estadoRetencion(aplicables, hechas, pagada));
}

/**
 * Estado GRUESO de una orden usando SOLO lo que la orden ya trae (sin leer el
 * libro ni caja): para la lista de Compras, de un vistazo. Se ancla en
 * retencion_finalizada y los paths de la OC. «retenida» y «pagada» coinciden con
 * el resto del módulo; solo el matiz «parcial» puede diferir en bordes (aquí es
 * «hay algún comprobante pero no se finalizó»). No conoce los aplicables reales.
 */
export function estadoRetencionSoloOrden(o: OrdenConRetencion): ResumenRetencion {
  const hechas = impuestosHechosDeOrden(o);
  const pagada = !!o.retencion_pagada;
  if (o.retencion_finalizada) return { estado: 'retenida', aplicables: hechas, hechas, faltantes: [], pagada };
  if (hechas.length > 0) return { estado: 'parcial', aplicables: hechas, hechas, faltantes: [], pagada };
  return { estado: 'no_retenida', aplicables: [], hechas: [], faltantes: [], pagada };
}

/* ───────── Adaptador: una FACTURA del buzón ───────── */

/** El estado de retención de una factura del buzón, a partir de su estatus. */
export function estadoRetencionDeBuzon(estatus: 'recibida' | 'en_revision' | 'retenida' | 'descartada'): ResumenRetencion {
  if (estatus === 'retenida') return { estado: 'retenida', aplicables: [], hechas: [], faltantes: [], pagada: false };
  if (estatus === 'descartada') return { estado: 'no_aplica', aplicables: [], hechas: [], faltantes: [], pagada: false };
  return { estado: 'no_retenida', aplicables: [], hechas: [], faltantes: [], pagada: false };
}
