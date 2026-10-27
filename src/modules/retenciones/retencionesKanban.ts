/* ============================================================
   MGG · Retenciones · Estatus Kanban de Compras en Retenciones
   Define y gestiona qué estatus del flujo de Compras / Servicios
   son considerados elegibles para retención en el módulo de Retenciones.
   Configurable desde Parámetros.
   ============================================================ */

export interface EstatusKanbanInfo {
  key: string;
  label: string;
  descripcion: string;
  recomendado: boolean;
  esTerminalCancelado?: boolean;
}

/** Estatus recomendados y activos por defecto para el cálculo y lista de retenciones. */
export const ESTATUS_KANBAN_DEFECTO: string[] = [
  'confirmada_metodo',
  'oc_aprobada',
  'cuenta_abierta',
  'por_recibir',
  'pagada',
  'recibida',
  'finalizada',
];

/** Catálogo completo de estatus del Kanban de Compras / Servicios. */
export const LISTA_ESTATUS_KANBAN: EstatusKanbanInfo[] = [
  { key: 'confirmada_metodo', label: 'Confirmada método de pago', descripcion: 'Con método de pago indicado, lista para validación', recomendado: true },
  { key: 'oc_aprobada', label: 'Confirmada pagar', descripcion: 'Aprobada por gerencia para emisión de pago en Tesorería', recomendado: true },
  { key: 'cuenta_abierta', label: 'Crédito / Cuenta abierta', descripcion: 'Compras a crédito de proveedores habituales', recomendado: true },
  { key: 'por_recibir', label: 'Pendiente por recepción', descripcion: 'Compra con pago tramitado, en espera de recepción física', recomendado: true },
  { key: 'pagada', label: 'Pagada', descripcion: 'Pago ejecutado por Tesorería', recomendado: true },
  { key: 'recibida', label: 'Recibida / Servicio realizado', descripcion: 'Mercancía o servicio recibido a satisfacción', recomendado: true },
  { key: 'finalizada', label: 'Finalizada', descripcion: 'Compra cerrada con recepción y pago completados', recomendado: true },
  { key: 'oc_creada', label: 'Por aprobación Gerente', descripcion: 'Borrador de OC pendiente de aprobación gerencial', recomendado: false },
  { key: 'aprobada', label: 'Pendiente cargar ofertas', descripcion: 'Etapa inicial de cotizaciones y selección de proveedor', recomendado: false },
  { key: 'pendiente', label: 'Solicitado / Pendiente cotizar', descripcion: 'Requerimiento o solicitud inicial de compra', recomendado: false },
  { key: 'cancelada', label: 'Cancelada', descripcion: 'Orden cancelada desde Compras (no genera retención)', recomendado: false, esTerminalCancelado: true },
  { key: 'anulada', label: 'Anulada', descripcion: 'Orden anulada administrativamente (no genera retención)', recomendado: false, esTerminalCancelado: true },
  { key: 'desistida_proveedor', label: 'Proveedor desistió', descripcion: 'Proveedor no aceptó o desistió del pedido', recomendado: false, esTerminalCancelado: true },
];

/** Retorna la lista de estatus habilitados según la configuración o los recomendados por defecto. */
export function estatusKanbanHabilitados(estatusGuardados?: string[] | null): string[] {
  if (Array.isArray(estatusGuardados) && estatusGuardados.length > 0) {
    return estatusGuardados;
  }
  return ESTATUS_KANBAN_DEFECTO;
}

/** Verifica si un estado de orden califica según los estatus permitidos configurados. */
export function ordenTieneEstatusRetencion(
  estado: string | null | undefined,
  estatusPermitidos: string[] = ESTATUS_KANBAN_DEFECTO,
): boolean {
  if (!estado) return false;
  return estatusPermitidos.includes(estado);
}

/** Comprueba si una orden se encuentra en un estado terminal de cancelación. */
export function esOrdenCanceladaOAnulada(estado: string | null | undefined): boolean {
  if (!estado) return false;
  return ['cancelada', 'anulada', 'desistida_proveedor'].includes(estado);
}
