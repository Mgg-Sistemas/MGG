/* ============================================================
   MGG · Cocina · qué categorías del inventario surten la cocina

   Una sola lista para todo el sistema: la usan el módulo de Alimentación
   (qué se puede repartir, qué entra al mercado), el Resumen detallado y,
   desde el 29-09-2026, el módulo de Salidas para saber qué NO debe
   descontar cuando va a la cocina (ver `entregaACocina.ts`).

   Se separa lo que se COME de lo que se usa para LIMPIAR: los platos
   consumen lo primero; lo segundo se gasta igual, pero nadie lo sirve.
   ============================================================ */

/** Lo que va en un plato o en un vaso: lo descuenta Distribución de comidas. */
export const CATEGORIAS_COMESTIBLES = [
  'VIVERES',
  'ALIMENTOS',
  'CARNES',
  'PROTEINA',
  'HORTALIZAS Y LEGUMBRES',
  'VERDURAS',
  'FRUTAS',
  'JUGOS',
  'BEBIDAS',
  'LACTEOS',
  'HUEVOS',
  'EMBUTIDOS',
  'CHARCUTERIA',
  'PESCADOS',
  'MARISCOS',
  'PANADERIA',
  'GRANOS',
  'CEREALES',
  'CONDIMENTOS',
  'ESPECIAS',
  'DULCES',
  'POSTRES',
];

/** Lo que se gasta en la cocina pero no se sirve: sale por Salidas, como siempre. */
export const CATEGORIAS_LIMPIEZA_COCINA = [
  'LIMPIEZA',
  'MATERIAL DE LIMPIEZA',
];

/** Todo lo que surte la distribución de comida (comestibles + limpieza). */
export const CATEGORIAS_COCINA = [...CATEGORIAS_COMESTIBLES, ...CATEGORIAS_LIMPIEZA_COCINA];

/**
 * Sin tildes, sin espacios de más, en mayúsculas y SIN la S final: el
 * 16/09/2026 el POLLO BENEFICIADO llegó con categoría «PROTEINAS» y Cocina
 * no lo veía en ninguna lista. «FRUTA» y «FRUTAS» son la misma cosa.
 */
const norm = (s: string): string => s
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .trim().toUpperCase().replace(/\s+/g, ' ').replace(/S$/, '');

const enLista = (cat: string | null | undefined, lista: readonly string[]): boolean => {
  const c = norm(cat ?? '');
  return !!c && lista.some((x) => norm(x) === c);
};

/** ¿La categoría de un producto surte la distribución de comida? */
export function esCategoriaCocina(cat?: string | null): boolean {
  return enLista(cat, CATEGORIAS_COCINA);
}

/** ¿Es algo que se come o se bebe? (lo descuenta Distribución de comidas, no Salidas). */
export function esComestible(cat?: string | null): boolean {
  return enLista(cat, CATEGORIAS_COMESTIBLES);
}
