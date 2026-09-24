/* ============================================================
   MGG · Cocina · La lista de la comida, ordenada por categoría

   Al registrar una comida se elegía de una lista corrida: en Los Pinos
   son 168 artículos, y las 13 carnes quedaban perdidas entre los
   víveres y los productos de limpieza. La carne es lo primero que se
   piensa al armar un plato y era lo más difícil de encontrar.

   Acá se agrupa por categoría y se pone primero lo que se cocina:
   carnes y proteínas, después el resto de la comida, y la limpieza al
   final —que no va en ningún plato, pero se consume igual—.
   ============================================================ */

/** Orden en que se muestran las categorías. Lo que no esté acá va al final, alfabético. */
export const ORDEN_CATEGORIAS = [
  'CARNES',
  'PROTEINAS',
  'HORTALIZAS Y LEGUMBRES',
  'VIVERES',
  'ALIMENTOS',
  'LIMPIEZA',
  'MATERIAL DE LIMPIEZA',
];

/** Cómo se rotula cada categoría en pantalla (con su ícono). */
const ROTULOS: Record<string, string> = {
  CARNES: '🥩 Carnes',
  PROTEINAS: '🍗 Proteínas',
  'HORTALIZAS Y LEGUMBRES': '🥬 Hortalizas y legumbres',
  VIVERES: '🧺 Víveres',
  ALIMENTOS: '🌾 Alimentos',
  LIMPIEZA: '🧽 Limpieza',
  'MATERIAL DE LIMPIEZA': '🧽 Material de limpieza',
};

/**
 * Categoría normalizada: sin tildes, sin espacios de más y en mayúsculas.
 *
 * NO se le quita la S final acá, a diferencia de `esCategoriaCocina`: eso sirve
 * para decidir si algo es de cocina, pero como clave de grupo dejaría «CARNE» y
 * «PROTEINA», que no es como se llaman las categorías en el inventario.
 */
export function normCategoria(cat?: string | null): string {
  return (cat ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim().toUpperCase().replace(/\s+/g, ' ');
}

/** El nombre que se muestra del grupo. Una categoría desconocida se muestra como viene. */
export function rotuloCategoria(cat: string): string {
  return ROTULOS[cat] ?? (cat || 'Sin categoría');
}

/** Dónde va esta categoría en la lista. Las conocidas primero, en su orden. */
export function posicionCategoria(cat: string): number {
  const i = ORDEN_CATEGORIAS.indexOf(cat);
  return i === -1 ? ORDEN_CATEGORIAS.length : i;
}

export interface GrupoCategoria<T> {
  /** Clave normalizada: 'CARNES'. */
  categoria: string;
  /** Rótulo para la pantalla: '🥩 Carnes'. */
  rotulo: string;
  items: T[];
}

/**
 * Agrupa los artículos por categoría, en el orden en que conviene cocinarlos.
 *
 * Dentro de cada grupo se respeta el orden en que venían (la lista ya llega
 * alfabética), así que dos artículos de la misma categoría no se mueven entre sí.
 */
export function agruparPorCategoria<T>(
  items: readonly T[],
  categoriaDe: (item: T) => string | null | undefined,
): Array<GrupoCategoria<T>> {
  const grupos = new Map<string, T[]>();
  for (const it of items ?? []) {
    const cat = normCategoria(categoriaDe(it));
    const g = grupos.get(cat);
    if (g) g.push(it); else grupos.set(cat, [it]);
  }
  return [...grupos.entries()]
    .map(([categoria, xs]) => ({ categoria, rotulo: rotuloCategoria(categoria), items: xs }))
    .sort((a, b) => (
      posicionCategoria(a.categoria) - posicionCategoria(b.categoria)
      || a.categoria.localeCompare(b.categoria, 'es')
    ));
}
