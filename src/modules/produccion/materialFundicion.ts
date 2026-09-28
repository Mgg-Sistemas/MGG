/* ============================================================
   MGG · Qué material cuenta como "de fundición"
   Un solo criterio para los dos lados del circuito: el check de
   Salidas («va para fundición») y el listado de materiales de la
   colada. Si discreparan, se podría marcar en la salida algo que
   después la colada no deja usar, y ese material quedaría trabado
   en el piso para siempre.
   ============================================================ */

/** Categoría con la que el inventario identifica a la materia prima. */
export const CATEGORIA_MATERIA_PRIMA = 'MP';

/** Lo mínimo que hay que saber de una ficha para decidir. */
export type FichaFundicion = {
  categoria?: string | null;
  es_receta?: boolean | null;
};

/**
 * Es material de fundición toda la MATERIA PRIMA, más cualquier ficha marcada
 * a mano como insumo de receta (que puede no ser MP: un reactivo de refinación,
 * por ejemplo). La marca manual suma, nunca resta.
 */
export function esMaterialDeFundicion(p: FichaFundicion | null | undefined): boolean {
  if (!p) return false;
  if (p.es_receta === true) return true;
  return (p.categoria ?? '').trim().toUpperCase() === CATEGORIA_MATERIA_PRIMA;
}

/* ───────────── Qué inventario mueve una colada: NADA ─────────────

   `MaterialConsumible`, `materialesAConsumir` y `porParProductoAlmacen` se
   eliminaron junto con el consumo.

   La fundición y la refinación REGISTRAN lo que se usó; no lo sacan del
   almacén. El material sale por su Salida, que es el documento que lo entrega
   y el único que lo descuenta. Mientras las dos cosas descontaban, el mismo
   kilo se iba dos veces y el inventario quedaba corto sin que nadie lo notara.

   Los materiales siguen guardándose en `produccion_materiales`: hacen falta
   para el costo de la colada y para el reporte. Lo que ya no hacen es tocar
   existencias. */
