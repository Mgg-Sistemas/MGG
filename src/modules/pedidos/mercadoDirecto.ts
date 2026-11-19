/* ============================================================
   MGG · Pedidos directos a Compras (19-11-2026)
   Regla de negocio: los ÚNICOS pedidos que pasan directo a Compras
   (sin revisión de almacén y sin esperar aprobación de la SP) son
   las COMPRAS FIJAS (`compra_fija_id` presente). Cualquier otro pedido,
   incluso de COCINA o ALIMENTACION cargado como solicitud suelta,
   pasa por el flujo regular (revisión de almacén cuando está activa).
   ============================================================ */

/** Finalidad general de un pedido de reposición de mercado (usada en plantilla Mercado e historial). */
export const FINALIDAD_MERCADO = 'PEDIDO PARA RESTABLECER EL MERCADO';

/** ¿Es una compra fija que pasa directo a Compras (sin revisión de almacén)? */
export function esPedidoDirectoACompras(o: { compra_fija_id?: string | null }): boolean {
  return Boolean(o.compra_fija_id && String(o.compra_fija_id).trim());
}

/** Alias compatible con llamadas existentes: solo las compras fijas pasan directo a Compras. */
export const esPedidoMercado = esPedidoDirectoACompras;
