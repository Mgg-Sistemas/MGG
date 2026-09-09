/* ============================================================
   MGG · Pedidos · dónde viven las ofertas de una orden
   ------------------------------------------------------------
   En una compra multiproveedor la OP madre se reparte en
   sub-órdenes (`parent_orden_id`), una por proveedor. Las
   ofertas NO se duplican en cada hija: viven en la orden madre
   y la hija las muestra completas, con la elegida marcada.

   El panel comparativo ya leía así, pero guardar y excluir
   miraban la orden propia. Con los dos criterios conviviendo,
   una oferta cargada parada sobre una sub-orden quedaba pegada
   a la hija, el panel la buscaba en el padre y no la mostraba,
   y al reintentar la exclusión SÍ la encontraba y escondía al
   proveedor: la oferta existía, era invisible y bloqueaba el
   reintento. Pasó 5 veces en 3 sub-órdenes.

   Por eso la regla vive acá y no repetida en cada pantalla:
   leer, escribir y excluir tienen que resolver la MISMA orden.
   ============================================================ */

/** Lo mínimo que hace falta de una orden para saber dónde van sus ofertas. */
export interface OrdenConPadre {
  id: string;
  parent_orden_id?: string | null;
}

/**
 * Id de la orden que guarda las ofertas. Para una sub-OC multiproveedor es su
 * madre; para una orden normal, ella misma.
 *
 * Se sube UN solo nivel a propósito: `parent_orden_id` apunta al padre directo,
 * no a la raíz del árbol. Con una sub-sub-orden (ej. SP-2026-0098-1-1) las
 * ofertas quedan en SP-2026-0098-1, que es de donde el panel las lee.
 */
export function ordenDeOfertas(orden: OrdenConPadre): string {
  return orden.parent_orden_id || orden.id;
}

/** ¿Esta orden cuelga de otra? Se usa para explicarle al usuario dónde quedó la oferta. */
export function esSubOrden(orden: OrdenConPadre): boolean {
  return !!orden.parent_orden_id;
}

/** Cuántos nombres se listan antes de resumir con «y N más». */
const MAX_NOMBRES = 3;

/**
 * Aviso de por qué faltan proveedores en el selector. `null` = no falta ninguno.
 *
 * El modal esconde a quien ya cargó una oferta (cada proveedor lleva una sola por
 * orden; las variantes de marca van dentro de la misma oferta con «+ marca»).
 * Hasta ahora los escondía en silencio: el analista escribía el nombre, no lo veía
 * y concluía que el proveedor no existía. Decirlo cuesta una línea y evita que
 * alguien vuelva a cargar lo que ya cargó.
 */
export function avisoProveedoresOcultos(
  proveedores: { id: string; razon_social: string; estado?: string }[],
  yaOfertaron: Set<string>,
): string | null {
  if (!yaOfertaron.size) return null;
  const nombres = proveedores
    .filter((p) => (p.estado ?? 'activo') === 'activo' && yaOfertaron.has(p.id))
    .map((p) => p.razon_social)
    .sort((a, b) => a.localeCompare(b, 'es'));
  if (!nombres.length) return null;

  const visibles = nombres.slice(0, MAX_NOMBRES).join(', ');
  const restan = nombres.length - MAX_NOMBRES;
  const lista = restan > 0 ? `${visibles} y ${restan} más` : visibles;
  const verbo = nombres.length === 1 ? 'ya cargó una oferta' : 'ya cargaron su oferta';
  return `${lista} ${verbo} en esta orden, por eso no aparecen acá. Para corregir un precio, editá la oferta desde la comparativa con el ✎.`;
}
