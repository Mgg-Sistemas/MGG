/* ============================================================
   MGG · Refinación · cuánto material HAY de verdad para refinar

   La lista de orígenes (coladas y refinaciones finalizadas) mostraba los kg que
   dio el proceso. Si después se corrige el inventario —una colada cargada de
   más, una merma, una salida— ese número queda viejo y refinación ofrece kg que
   ya no existen. Acá se topa cada origen contra el STOCK REAL de su producto en
   su almacén.

   Cuando varios orígenes comparten producto y almacén, el stock se reparte por
   orden de fecha (el más viejo primero): así la corrección le pega al último
   proceso, que es el que normalmente la causó.
   ============================================================ */

export interface OrigenRefinable {
  produccion_id: string;
  producto_id: string | null;
  almacen: string;
  fecha: string;
  colada_num: number;
  /** Kg que dio el proceso (lo que decía la colada / refinación). */
  estano_kg: number;
}

export interface StockAlmacen { producto_id: string; almacen: string; stock: number }

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Devuelve cada origen con `estano_kg` = lo que realmente hay en inventario y
 * `producido_kg` = lo que dio el proceso. Un origen sin producto o sin fila de
 * existencia se deja como está (no hay contra qué toparlo).
 */
export function conDisponibleReal<T extends OrigenRefinable>(
  origenes: T[],
  existencias: StockAlmacen[],
): Array<T & { producido_kg: number }> {
  const restante = new Map<string, number>();
  for (const e of existencias) {
    if (!e.producto_id || !e.almacen) continue;
    restante.set(`${e.producto_id}|${e.almacen}`, Number(e.stock) || 0);
  }

  // Más viejo primero: el recorte le toca al proceso más reciente.
  const orden = [...origenes].sort((a, b) =>
    (a.fecha || '').localeCompare(b.fecha || '') || (a.colada_num || 0) - (b.colada_num || 0));

  const disponible = new Map<string, number>();
  for (const o of orden) {
    const producido = Math.max(0, Number(o.estano_kg) || 0);
    const clave = o.producto_id ? `${o.producto_id}|${o.almacen}` : '';
    if (!clave || !restante.has(clave)) { disponible.set(o.produccion_id, producido); continue; }
    const queda = restante.get(clave) ?? 0;
    const toma = Math.max(0, Math.min(producido, queda));
    restante.set(clave, round2(queda - toma));
    disponible.set(o.produccion_id, round2(toma));
  }

  return origenes.map((o) => ({
    ...o,
    producido_kg: round2(Math.max(0, Number(o.estano_kg) || 0)),
    estano_kg: disponible.get(o.produccion_id) ?? round2(Number(o.estano_kg) || 0),
  }));
}
