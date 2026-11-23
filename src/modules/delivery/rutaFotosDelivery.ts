/* ============================================================
   MGG · Delivery · por dónde se guarda cada grupo de fotos (23/11/2026)
   Módulo sin imports para que se pueda probar con Node directamente.
   ============================================================ */

export type TipoFotoDeliveryRuta = 'recibo' | 'entrega' | 'factura';

export type RutaFotosDelivery = 'delivery_fotos' | 'delivery_editar_fotos' | null;

/**
 * Con el pedido ABIERTO (aceptado/en_ruta) se usa `delivery_fotos`, que la base
 * ya tiene y que valida que sea el dueño; `delivery_editar_fotos` solo sirve
 * para pedidos ENTREGADOS. La factura no la acepta `delivery_fotos`, por eso
 * queda disponible recién al editar un pedido entregado.
 */
export function rutaGuardadoFotos(estado: string, tipo: TipoFotoDeliveryRuta): RutaFotosDelivery {
  if (estado === 'entregado') return 'delivery_editar_fotos';
  if (estado !== 'aceptado' && estado !== 'en_ruta') return null;
  if (tipo === 'factura') return null;
  return 'delivery_fotos';
}
