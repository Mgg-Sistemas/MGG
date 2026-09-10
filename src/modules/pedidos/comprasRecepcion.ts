/* ============================================================
   MGG · Compra directa · Recibir dos veces no puede duplicar el stock

   Recibir una compra son dos escrituras que no son una sola: primero
   entra cada material al inventario, después se marca la compra como
   recibida. Si la segunda se corta (la red, un timeout), el material ya
   entró pero la compra sigue apareciendo POR RECIBIR — y el almacenista
   hace lo natural: vuelve a darle al botón.

   Eso le pasó a CD-2026-0065 el 10/09/2026: la laptop entró dos veces y
   el stock pasó de 1 a 3 con una sola unidad comprada.

   Acá se decide qué renglones FALTAN por entrar, comparando lo que la
   compra tiene contra las entradas que ya quedaron registradas a su
   nombre. Un reintento retoma donde quedó en vez de empezar de nuevo.
   ============================================================ */

/** Lo mínimo que se necesita saber de una entrada ya registrada en el kardex. */
export interface EntradaRegistrada {
  producto_id?: string | null;
}

/**
 * Renglones de la compra que todavía NO entraron al inventario.
 *
 * Se descuenta una entrada ya registrada por cada renglón del mismo material,
 * en orden: si la compra trae dos renglones de la misma laptop y solo una
 * entró, queda pendiente exactamente uno.
 */
export function faltanPorEntrar<T extends { producto_id?: string | null }>(
  items: T[],
  yaRegistradas: EntradaRegistrada[],
): T[] {
  const cuenta = new Map<string, number>();
  for (const e of yaRegistradas ?? []) {
    const id = (e?.producto_id ?? '').trim();
    if (id) cuenta.set(id, (cuenta.get(id) ?? 0) + 1);
  }
  const pendientes: T[] = [];
  for (const it of items ?? []) {
    const id = (it?.producto_id ?? '').trim();
    const hechas = id ? cuenta.get(id) ?? 0 : 0;
    if (hechas > 0) { cuenta.set(id, hechas - 1); continue; }
    pendientes.push(it);
  }
  return pendientes;
}
