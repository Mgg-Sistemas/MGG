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

/** Tope para una subida: pasado este tiempo se da por perdida y se pide reintentar. */
export const TOPE_SUBIDA_MS = 120_000;

/**
 * Calcula un tiempo de espera adaptativo según el tamaño del archivo en bytes.
 * Mínimo 90s, escalable para conexiones lentas y archivos pesados de +50 MB (máximo 5 minutos).
 */
export function topeSubidaParaArchivo(bytes?: number): number {
  if (!bytes || bytes <= 0) return TOPE_SUBIDA_MS;
  const segs = Math.max(90, Math.ceil(bytes / (100 * 1024)) + 60);
  return Math.min(300_000, segs * 1000);
}

/**
 * Traduce el error de subir un documento al Storage. «Failed to fetch» es un
 * TypeError del navegador (se cortó la red o hay un problema de CORS), no un
 * error de Supabase; sin traducir llegaba crudo al toast. Mismo criterio que
 * `choferes/archivosChofer.ts:mensajeErrorDocumento`.
 */
export function mensajeErrorSubidaAdmin(error: unknown, nombre?: string | null): string {
  const err = (error ?? {}) as { code?: unknown; message?: unknown; name?: unknown };
  const code = String(err.code ?? '');
  const msg = extraerMensajeError(error, '').trim();
  const etiqueta = nombre ? `«${nombre}»` : 'el archivo';

  // El mensaje del tope ya está escrito para el usuario: no lo reformulamos.
  if (/tardó más de|timeout|timed out/i.test(msg)) return msg;
  if (/failed to fetch|network|fetch failed|FunctionsFetchError/i.test(msg) || err.name === 'TypeError')
    return `Se cortó la conexión mientras subía ${etiqueta}. Revisá la señal y volvé a intentar.`;
  if (code === '23505' || /duplicate key|already exists|resource already exists/i.test(msg))
    return nombre ? `Ya existe un archivo con el nombre ${etiqueta}.` : 'Ya existe un archivo con ese nombre.';
  if (code === '42501' || /row-level security|permission denied|Unauthorized|not authorized/i.test(msg))
    return 'Tu usuario no tiene permiso para cargar documentos de Administración.';
  if (/payload too large|exceeded the maximum|entity too large/i.test(msg))
    return nombre ? `El archivo ${etiqueta} es demasiado grande para el almacén.` : 'El archivo es demasiado grande para el almacén.';
  if (/bucket not found/i.test(msg))
    return 'Falta configurar el almacén de documentos (bucket). Avisá a sistemas.';
  return msg ? `No se pudo subir ${etiqueta}: ${msg}` : `No se pudo subir ${etiqueta}.`;
}

/** Sube con tope de tiempo: si la señal se corta, el error dice qué hacer. */
export function conTopeSubida<T>(promesa: Promise<T>, nombre: string, ms = TOPE_SUBIDA_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`«${nombre}» tardó más de ${Math.round(ms / 1000)} s en subir. Revisá la señal y volvé a intentar.`)),
      ms,
    );
    promesa.then(
      (valor) => { clearTimeout(t); resolve(valor); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}
