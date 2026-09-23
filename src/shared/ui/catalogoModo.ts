/* ============================================================
   MGG · Campo de catálogo — cuándo se muestra como chips y
   cuándo como buscador.

   Un puñado de opciones se elige más rápido a golpe de vista que
   abriendo un desplegable: se ven todas juntas y se toca la que va.
   Pasado cierto punto los chips se desbordan en varias filas, hay que
   leerlos uno por uno y el buscador gana.

   El corte lo fijó el usuario: desde CINCO opciones, buscador.
   ============================================================ */

/** Desde cuántas opciones el campo deja de ser chips y pasa a buscador. */
export const TOPE_CHIPS = 5;

export type ModoCatalogo = 'chips' | 'buscador';

/**
 * Cómo se dibuja un campo de catálogo según cuántas opciones tenga.
 *
 * Cuenta las opciones que se van a mostrar de verdad —incluida la que ya
 * estaba guardada aunque la hayan dado de baja—, porque esa también ocupa
 * lugar en la fila de chips.
 */
export function modoCatalogo(cantidadOpciones: number): ModoCatalogo {
  return cantidadOpciones >= TOPE_CHIPS ? 'buscador' : 'chips';
}

/**
 * Las opciones que se muestran: las del catálogo más la que la ficha ya
 * tenía guardada, si alguien la dio de baja después.
 *
 * Sin esto, abrir un reporte viejo y guardarlo le borraba el proveedor solo
 * porque ya no estaba en la lista.
 */
export function opcionesConGuardada(opciones: string[], guardada?: string | null): string[] {
  const v = (guardada ?? '').trim();
  if (!v) return opciones;
  return opciones.some((o) => o.toLowerCase() === v.toLowerCase()) ? opciones : [...opciones, v];
}
