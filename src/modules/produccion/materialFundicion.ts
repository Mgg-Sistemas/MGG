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
