/* ============================================================
   MGG · Margen único de TODOS los PDF del sistema (05-10-2026)

   Regla de la administradora: 2 cm por cada lado, en todos los documentos.
   Todos los PDF se generan en puntos (unit: 'pt'): 1 cm = 72 / 2,54 pt.

   Nada se dibuja fuera de este marco: ni el encabezado, ni el logo, ni las
   tablas, ni las firmas, ni el pie con el número de página.
   ============================================================ */

/** 2 cm en puntos. */
export const MARGEN_PDF = (2 * 72) / 2.54; // 56,69 pt

/** Los cuatro márgenes para `autoTable` (arriba, abajo, izquierda, derecha). */
export const MARGENES_TABLA_PDF = {
  top: MARGEN_PDF, right: MARGEN_PDF, bottom: MARGEN_PDF, left: MARGEN_PDF,
} as const;

/** La última línea en la que se puede escribir (el pie va acá, no más abajo). */
export function limiteInferiorPdf(altoPagina: number): number {
  return altoPagina - MARGEN_PDF;
}

/** El ancho útil entre los dos márgenes. */
export function anchoUtilPdf(anchoPagina: number): number {
  return anchoPagina - 2 * MARGEN_PDF;
}
