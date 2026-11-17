/* ============================================================
   Golden Touch · Administración · Reconocimiento de errores
   Fuente ÚNICA del predicado «la tabla aún no existe» para que las
   lecturas degraden con gracia mientras BD no haya aplicado el SQL.
   ============================================================ */

/** `true` si el error de Supabase/PostgREST indica que la tabla/relación
 *  no existe todavía (relation ... does not exist, o schema cache). */
export function esErrorTablaAusente(error: unknown): boolean {
  const msg = (error as { message?: unknown } | null)?.message;
  if (typeof msg !== 'string') return false;
  return /relation|does not exist|schema cache/i.test(msg);
}
