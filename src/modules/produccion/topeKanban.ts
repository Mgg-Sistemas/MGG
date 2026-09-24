/* ============================================================
   MGG · Producción · Cuántas tarjetas muestra el Kanban

   El Kanban es el tablero de TRABAJO: sirve para ver lo que está
   pasando ahora. Una columna de finalizados que crece sin techo lo
   convierte en un archivo por el que hay que scrollear, y lo que
   importa —lo que está en el horno— queda enterrado.

   Por eso la columna de finalizados muestra las ÚLTIMAS y el resto
   se consulta en la vista Lista, que tiene búsqueda y filtros. El
   encabezado sigue diciendo el TOTAL: si dice 48, hay 48.
   ============================================================ */

/** Cuántas producciones finalizadas se ven en el tablero. */
export const TOPE_FINALIZADOS = 10;

export interface RecorteKanban<T> {
  /** Las que se dibujan como tarjeta. */
  visibles: T[];
  /** Cuántas quedaron fuera (0 si entran todas). */
  ocultas: number;
  /** ¿Hace falta ofrecer el salto a la Lista? */
  hayMas: boolean;
}

/**
 * Recorta una columna del Kanban a las primeras `tope`.
 *
 * La lista llega ya ordenada de más nueva a más vieja, así que las primeras
 * son las últimas que pasaron — que es lo que alguien quiere ver al entrar.
 */
export function recorteKanban<T>(filas: T[], tope: number = TOPE_FINALIZADOS): RecorteKanban<T> {
  const t = Number.isFinite(tope) && tope > 0 ? Math.floor(tope) : TOPE_FINALIZADOS;
  if (filas.length <= t) return { visibles: filas, ocultas: 0, hayMas: false };
  return { visibles: filas.slice(0, t), ocultas: filas.length - t, hayMas: true };
}
