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
  /**
   * Se descuenta aunque la orden sea una CARGA VIEJA.
   *
   * Es para lo que nunca pasó por una Salida: la casiterita de los big bags
   * sale derecho del Inventario Detallado (SnO₂) y no tiene otro documento que
   * la baje. Si la colada no la descuenta, la bolsa queda disponible para
   * siempre y se puede volver a quemar.
   */
  siempre_descuenta?: boolean | null;
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
export function materialesAConsumir<T extends MaterialConsumible>(materiales: T[], descuentaLaOrden = true): T[] {
  return (materiales ?? []).filter((m) => (
    !!m.producto_id
    && m.desde_fundicion !== true
    && (descuentaLaOrden || m.siempre_descuenta === true)
  ));
}

/**
 * Los consumos agrupados por (producto, almacén).
 *
 * `crearProduccion` descontaba todos los materiales en paralelo, con el
 * argumento de que «cada material es un producto distinto». Dejó de ser cierto:
 * una refinación toma el estaño crudo de VARIAS coladas —mismo producto, mismo
 * almacén, una línea por colada— y la casiterita de una fundición puede venir en
 * varias bolsas. Dos escrituras simultáneas sobre la misma fila de existencia
 * leen el mismo stock anterior y la segunda pisa a la primera: el inventario
 * queda corto por la diferencia, sin ningún error a la vista.
 *
 * Con esto, lo que comparte fila se descuenta EN ORDEN y lo que no, sigue en
 * paralelo.
 */
export function porParProductoAlmacen<T extends { producto_id?: string | null; almacen: string }>(items: T[]): T[][] {
  const grupos = new Map<string, T[]>();
  for (const it of items ?? []) {
    const clave = `${it.producto_id ?? ''}|${it.almacen ?? ''}`;
    const g = grupos.get(clave);
    if (g) g.push(it); else grupos.set(clave, [it]);
  }
  return [...grupos.values()];
}
