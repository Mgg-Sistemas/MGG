/* ============================================================
   MGG · Delivery · por dónde se guarda cada grupo de fotos (23/11/2026)
   Módulo sin imports para que se pueda probar con Node directamente.
   ============================================================ */

export type TipoFotoDeliveryRuta = 'recibo' | 'entrega' | 'factura';

export type RutaFotosDelivery = 'delivery_fotos' | 'delivery_editar_fotos' | null;

/**
 * Con el pedido ABIERTO (aceptado/en_ruta) se usa `delivery_fotos`, que valida
 * que sea el dueño; desde 26/11/2026 también acepta `factura`, para que el
 * celular pueda cargar la foto de la factura sin esperar a entregar.
 * `delivery_editar_fotos` solo sirve para pedidos ENTREGADOS.
 */
export function rutaGuardadoFotos(estado: string, _tipo: TipoFotoDeliveryRuta): RutaFotosDelivery {
  if (estado === 'entregado') return 'delivery_editar_fotos';
  if (estado !== 'aceptado' && estado !== 'en_ruta') return null;
  return 'delivery_fotos';
}
