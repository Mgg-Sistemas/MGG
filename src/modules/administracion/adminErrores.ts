/* ============================================================
   Golden Touch · Administración · Reconocimiento de errores
   Fuente ÚNICA del predicado «la tabla aún no existe» para que las
   lecturas degraden con gracia mientras BD no haya aplicado el SQL.
   ============================================================ */

/** `true` si el error de Supabase/PostgREST indica que la tabla/relación
 *  no existe todavía (relation ... does not exist, o schema cache). */
export function esErrorTablaAusente(error: unknown): boolean {
  const msg = typeof error === 'string' ? error : (error as { message?: unknown } | null)?.message;
  if (typeof msg !== 'string') return false;
  return /relation|does not exist|schema cache|42P01|PGRST204/i.test(msg);
}

/** Extrae el mensaje legible de un error (compatible con Error y PostgrestError). */
export function extraerMensajeError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === 'object') {
    const obj = error as { message?: unknown; details?: unknown; hint?: unknown };
    if (typeof obj.message === 'string' && obj.message.trim()) return obj.message.trim();
    if (typeof obj.details === 'string' && obj.details.trim()) return obj.details.trim();
  }
  if (typeof error === 'string' && error.trim()) return error.trim();
  return fallback;
}
