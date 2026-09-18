/* ============================================================
   Errores de Edge Functions y de Auth, en español y con el motivo real.

   supabase-js, cuando una Edge Function responde con 4xx/5xx, devuelve un error
   que solo dice «Edge Function returned a non-2xx status code»: el motivo real
   viene en el cuerpo de la respuesta ({ error } o { message }) y nadie lo leía.
   El cliente (`supabase.ts`) pasa TODA llamada a `functions.invoke` por acá.
   ============================================================ */

/** Traduce los mensajes conocidos de Supabase Auth / Edge; el resto queda igual. */
export function traducirErrorAuth(msg: string): string {
  const m = (msg || '').trim();
  const reglas: [RegExp, string][] = [
    [/known to be weak|easy to guess|pwned|leaked/i,
      'Esa clave aparece en listas de claves filtradas en internet. Elegí otra (combiná letras, números y un símbolo).'],
    [/should be at least (\d+) characters/i, 'La clave es muy corta: debe tener al menos $1 caracteres.'],
    [/already (been )?registered|already exists|email_exists/i, 'Ya existe un usuario con ese correo.'],
    [/same as (the )?(old|existing) password|should be different/i, 'La clave nueva tiene que ser distinta de la anterior.'],
    [/invalid login credentials/i, 'Correo o clave incorrectos.'],
    [/email not confirmed/i, 'El correo todavía no está confirmado.'],
    [/rate limit|too many requests/i, 'Demasiados intentos seguidos. Esperá un momento y volvé a probar.'],
    [/failed to send a request to the edge function|failed to fetch|networkerror/i,
      'No se pudo conectar con el servidor. Revisá la conexión e intentá de nuevo.'],
    [/relay error/i, 'El servidor no respondió. Intentá de nuevo en un momento.'],
  ];
  for (const [re, texto] of reglas) {
    const r = m.match(re);
    if (r) return texto.replace('$1', r[1] ?? '');
  }
  return m;
}

/** Mensaje genérico según el código HTTP, cuando la función no dijo el motivo. */
export function mensajePorEstado(status: number | null | undefined): string {
  if (status === 401) return 'Tu sesión venció. Volvé a iniciar sesión.';
  if (status === 403) return 'No tenés permiso para esta acción.';
  if (status === 404) return 'El servicio no está disponible (función no encontrada).';
  if (status && status >= 500) return `El servidor tuvo un error (código ${status}). Intentá de nuevo; si sigue, avisá a sistemas.`;
  if (status) return `El servidor rechazó la operación (código ${status}).`;
  return 'El servidor rechazó la operación.';
}

/**
 * Motivo legible de un error de `functions.invoke`: lee el cuerpo de la respuesta
 * (`{ error }` o `{ message }`) si existe, lo traduce y, si no hay cuerpo, usa el código.
 */
export async function mensajeErrorFuncion(error: unknown): Promise<string> {
  const e = error as { message?: string; context?: unknown } | null;
  const ctx = e?.context;
  if (ctx && typeof (ctx as Response).clone === 'function') {
    const res = ctx as Response;
    let motivo = '';
    try {
      const texto = await res.clone().text();
      try {
        const j = JSON.parse(texto) as { error?: unknown; message?: unknown; msg?: unknown };
        const v = j?.error ?? j?.message ?? j?.msg;
        motivo = typeof v === 'string' ? v : v ? JSON.stringify(v) : '';
      } catch {
        motivo = texto.length < 300 ? texto : '';
      }
    } catch { /* cuerpo ilegible: queda el código */ }
    return motivo.trim() ? traducirErrorAuth(motivo) : mensajePorEstado(res.status);
  }
  return traducirErrorAuth(e?.message ?? '');
}
