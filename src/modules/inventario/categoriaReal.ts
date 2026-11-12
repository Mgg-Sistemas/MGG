/* ============================================================
   MGG · La categoría (traído de Golden Touch 11-11-2026) de un producto tiene que ser real

   GENERAL era el cajón de sastre: las altas rápidas (solicitud,
   OC, Tesorería, permuta, salidas temporales, Excel) la ponían
   solas cuando nadie elegía nada, y llegó a juntar 258 productos
   mezclados — filtros, aceites, teléfonos, fletes. El 15/09/2026
   se repartieron en su categoría real y la base dejó de aceptarla
   (trigger `trg_productos_categoria_real`). Esto es el mismo
   control del lado de la pantalla, para avisar antes de guardar.
   ============================================================ */

export const MENSAJE_CATEGORIA_OBLIGATORIA = 'Elige la categoría del producto. GENERAL ya no es una categoría.';

/** `true` si la categoría sirve: no vacía y no GENERAL (sin importar mayúsculas ni espacios). */
export function esCategoriaReal(categoria: string | null | undefined): boolean {
  const c = (categoria ?? '').trim().toLowerCase();
  return c !== '' && c !== 'general';
}
