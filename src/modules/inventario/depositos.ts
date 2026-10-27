/* ============================================================
   Golden Touch · Inventario · Depósitos

   Dos depósitos independientes (05/10/2026, pedido del usuario):
   - Inventario General: todo lo de siempre (compras, salidas, cocina…).
   - Depósito Mina: submódulo de Inventario con su propio catálogo y stock.
   Un producto es de uno solo (productos.almacen) y la base no deja pasarlo
   al otro (trg_productos_deposito_fijo). Sus movimientos y existencias van al
   almacén del producto (registrar_movimiento_stock).
   ============================================================ */

export type Deposito = 'general' | 'mina';

export const ALMACEN_GENERAL = 'General';
export const ALMACEN_MINA = 'Depósito Mina';

export const DEPOSITOS: Record<Deposito, { almacen: string; nombre: string; ruta: string; hash: string }> = {
  general: { almacen: ALMACEN_GENERAL, nombre: 'Inventario General', ruta: '/app/inventario', hash: '#/app/inventario' },
  mina: { almacen: ALMACEN_MINA, nombre: 'Depósito Mina', ruta: '/app/inventario/deposito-mina', hash: '#/app/inventario/deposito-mina' },
};

/** Depósito al que pertenece un producto (todo lo que no es de la Mina es del General). */
export function depositoDe(p: { almacen?: string | null }): Deposito {
  return p.almacen === ALMACEN_MINA ? 'mina' : 'general';
}

export function esDelDeposito(p: { almacen?: string | null }, d: Deposito): boolean {
  return depositoDe(p) === d;
}
