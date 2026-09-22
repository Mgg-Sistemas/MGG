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

/* ───────────── Qué se descuenta del inventario ───────────── */

export interface MaterialConsumible {
  /** null = material MANUAL: no está en inventario, no se descuenta. */
  producto_id?: string | null;
  /**
   * Vino del PISO DE FUNDICIÓN: ya se descontó del inventario cuando se hizo
   * su salida marcada «va para fundición».
   */
  desde_fundicion?: boolean | null;
}

/**
 * Los materiales que HAY que descontar del inventario al producir.
 *
 * Quedan afuera dos casos, por razones distintas:
 * · el material MANUAL, porque nunca estuvo en el inventario;
 * · el que vino del PISO, porque ya se descontó al sacarlo.
 *
 * Descontar uno del piso otra vez deja el inventario corto sin que nadie lo
 * note. Ya pasó una vez: el formulario de edición no arrastraba la marca
 * `desde_fundicion`, así que al editar una colada el material del piso volvía
 * a descontarse.
 */
export function materialesAConsumir<T extends MaterialConsumible>(materiales: T[]): T[] {
  return (materiales ?? []).filter((m) => !!m.producto_id && m.desde_fundicion !== true);
}
