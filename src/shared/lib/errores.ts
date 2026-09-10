/* ============================================================
   MGG · El texto de un error, venga de donde venga

   Supabase no lanza un `Error`: lanza un objeto plano
   `{ message, details, hint, code }`. Como las pantallas preguntan
   `err instanceof Error`, ese mensaje se perdía y el usuario veía la
   frase genérica de respaldo, sin la causa. Así se cayó la recepción de
   la compra CD-2026-0065: el aviso decía «No se pudo recibir la compra
   directa» y no había forma de saber por qué.

   Acá se saca el texto de cualquiera de las dos formas.
   ============================================================ */

const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * Mensaje legible de un error. `respaldo` es lo que se muestra cuando el
 * error no trae absolutamente nada que decir.
 */
export function textoDeError(e: unknown, respaldo: string): string {
  if (e instanceof Error && e.message.trim()) return e.message.trim();
  if (typeof e === 'string' && e.trim()) return e.trim();
  if (e && typeof e === 'object') {
    const o = e as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    // message → qué pasó; details/hint → el detalle de Postgres, que suele ser
    // lo único que explica un choque de restricción o de permisos.
    const partes = [texto(o.message), texto(o.details), texto(o.hint)].filter(Boolean);
    const cod = texto(o.code);
    if (partes.length) return partes.join(' · ') + (cod ? ` [${cod}]` : '');
    if (cod) return `${respaldo} [${cod}]`;
  }
  return respaldo;
}
