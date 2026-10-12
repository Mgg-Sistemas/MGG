/**
 * Filtro por VARIAS categorías (12-10-2026): sin nada marcado no filtra; con
 * una o más, el producto pasa si su categoría es alguna de ellas.
 */
export function pasaFiltroCategorias(seleccionadas: readonly string[], categoria: string | null | undefined): boolean {
  if (!seleccionadas.length) return true;
  return seleccionadas.includes(categoria ?? '');
}
