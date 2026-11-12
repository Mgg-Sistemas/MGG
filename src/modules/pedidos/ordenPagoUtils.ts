/* ============================================================
   MGG · Pedidos · Utilidades puras de estado y método de pago
   ============================================================ */

export type ConOrdenLike = {
  orden?: {
    estado?: string | null;
    metodo_pago?: unknown;
  } | null;
  estado?: string | null;
  metodo_pago?: unknown;
  esperandoMetodo?: boolean | null;
};

/**
 * Devuelve true si la orden ya tiene método de pago indicado por Compras.
 * En Tesorería solo se muestran órdenes que ya tengan método de pago cargado
 * (no en confirmada_metodo ni con esperandoMetodo = true).
 */
export function tieneMetodoPagoCargado(o: ConOrdenLike): boolean {
  if (!o) return false;
  const orden = ('orden' in o && o.orden) ? o.orden : o;
  if (!orden || orden.estado === 'confirmada_metodo') return false;
  if ('esperandoMetodo' in o && Boolean(o.esperandoMetodo)) return false;
  const mp = orden.metodo_pago;
  if (!mp) return false;
  if (Array.isArray(mp)) {
    return mp.length > 0 && mp.some((m) => {
      if (!m || typeof m !== 'object') return false;
      const r = m as Record<string, unknown>;
      return Boolean(r.metodo || r.tipo);
    });
  }
  return true;
}
