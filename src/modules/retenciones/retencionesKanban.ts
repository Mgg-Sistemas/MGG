/* ============================================================
   Golden Touch · Retenciones · Estatus Kanban & Impuestos de Orden
   
   Provee los badges e identificadores visuales en el módulo de Retenciones
   para mostrar el estatus de la orden en el Kanban de Compras y advertir
   claramente si la orden viene o no con IVA cargado desde Compras.
   ============================================================ */

import type { EstadoOrden, Orden } from '@/shared/lib/types';
import { money } from '@/shared/lib/format';

export interface BadgeInfo {
  label: string;
  className: string;
  tooltip?: string;
}

export function badgeEstatusKanban(estado?: EstadoOrden | string | null): BadgeInfo {
  switch (estado) {
    case 'pagada':
      return { label: '✓ Pagada', className: 'badge success', tooltip: 'Pagada por Tesorería' };
    case 'oc_aprobada':
      return { label: 'Confirmada pagar', className: 'badge warning', tooltip: 'En cola para pago en Tesorería' };
    case 'por_recibir':
      return { label: 'Por recibir', className: 'badge info', tooltip: 'Esperando recepción de mercancía' };
    case 'recibida':
      return { label: 'Recibida', className: 'badge info', tooltip: 'Mercancía recibida en almacén' };
    case 'cuenta_abierta':
      return { label: 'Crédito', className: 'badge warning', tooltip: 'Compra a crédito (cuenta abierta)' };
    case 'finalizada':
      return { label: 'Finalizada', className: 'badge', tooltip: 'Proceso de compra finalizado' };
    case 'confirmada_metodo':
      return { label: 'Método de pago', className: 'badge', tooltip: 'Aprobada, por indicar método de pago' };
    case 'oc_creada':
      return { label: 'Por aprobación', className: 'badge', tooltip: 'Esperando aprobación de Gerencia' };
    case 'aprobada':
      return { label: 'Aprobada', className: 'badge', tooltip: 'OP aprobada para cotizar' };
    case 'oc_emitida':
      return { label: 'Emitida', className: 'badge', tooltip: 'Orden emitida al proveedor' };
    case 'cancelada':
      return { label: 'Cancelada', className: 'badge danger', tooltip: 'Orden cancelada' };
    case 'desistida_proveedor':
      return { label: 'Desistida', className: 'badge danger', tooltip: 'Proveedor desistió' };
    default:
      return { label: estado || 'Sin estatus', className: 'badge', tooltip: estado ?? undefined };
  }
}

export function badgeImpuestoOrden(o: Pick<Orden, 'iva_aplicado' | 'iva_monto' | 'iva_pct' | 'total_moneda'>): BadgeInfo & { tieneImpuesto: boolean } {
  const tiene = !!o.iva_aplicado && Number(o.iva_monto ?? 0) > 0;
  if (tiene) {
    const pct = Number(o.iva_pct ?? 16);
    const monto = money(Number(o.iva_monto));
    const mon = o.total_moneda === 'Bs' ? 'Bs' : '$';
    return {
      tieneImpuesto: true,
      label: `Con IVA (${pct}%)`,
      className: 'badge info',
      tooltip: `La OC registra IVA por ${mon} ${monto}`,
    };
  }
  return {
    tieneImpuesto: false,
    label: 'Sin IVA en OC',
    className: 'badge',
    tooltip: 'Esta orden no tiene IVA registrado en Compras (revisar factura física del proveedor)',
  };
}
