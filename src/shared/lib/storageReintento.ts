/* ============================================================
   MGG · Subir al Storage con reintento cuando el fallo es del servidor

   20-10-2026: la administradora sube una foto de un equipo (kavak.jpeg) y
   el sistema avisa «No se pudieron subir 1 foto(s): kavak.jpeg: HTTP 520
   error». La foto estaba sana: se comprime a JPG de ~1600 px y menos de
   1 MB antes de subir. El 520 lo devuelve SUPABASE: es el «web server
   returned an unknown error» de Cloudflare y su Storage lo tira de forma
   INTERMITENTE — los foros de Supabase lo reportan fallando en ~10-15%
   de las subidas (canary LB de us-east-1), sin que el archivo tenga
   nada que ver.

   supabase-js reintenta GET y HEAD ante 520/503, pero un upload es POST
   y NO reintenta: el fallo llegaba entero a la pantalla, con el texto
   genérico del proxy («HTTP 520 error»), que no le dice nada a nadie.

   Acá se reintenta la subida: MISMO archivo en la MISMA ruta (que ya es
   única, la arma cada llamada), 3 intentos con pausa corta. Si el primer
   intento SÍ llegó y se perdió la respuesta, Supabase contesta «ya
   existe» — eso cuenta como subida, no como error. Todo lo que NO sea
   cosa del servidor o de la red (permisos, política del bucket, archivo
   pesado, formato) se lanza tal cual, con el mensaje original de Supabase.
   ============================================================ */

/** Cuántas veces se intenta subir antes de rendirse. */
export const INTENTOS_SUBIDA = 3;
/** Pausa entre intentos (ms): 3 intentos = 2 pausas. */
export const ESPERAS_SUBIDA_MS = [600, 1800];

/** Códigos que el servidor devuelve cuando es cosa SUYA y se arregla sola. */
const ESTADOS_TRANSITORIOS = [500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527];

/** El texto genérico del proxy («HTTP 520 error»): no explica nada. */
function esRuidoHttp(m: string): boolean {
  return /^http \d{3} error$/i.test(m.trim());
}

/** El estado HTTP del error, si lo trae (los errores de storage lo traen como `status`). */
export function estadoHttp(e: unknown): number | null {
  if (e && typeof e === 'object') {
    const s = Number((e as { status?: unknown }).status);
    if (Number.isFinite(s) && s > 0) return Math.trunc(s);
    const m = /HTTP (\d{3}) error/i.exec(String((e as { message?: unknown }).message ?? ''));
    if (m) return Number(m[1]);
  }
  if (typeof e === 'string') {
    const m = /HTTP (\d{3}) error/i.exec(e);
    if (m) return Number(m[1]);
  }
  return null;
}

const mensajeDe = (e: unknown): string => {
  if (e instanceof Error) return e.message ?? '';
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') return String((e as { message?: unknown }).message ?? '');
  return '';
};

/** Se cortó la conexión a mitad de la subida (también se puede repetir). */
export function esFallaDeRed(e: unknown): boolean {
  return /Failed to fetch|NetworkError|Load failed|ERR_(INTERNET|NETWORK|CONNECTION|TIMED_OUT)|ECONN|socket hang up/i.test(mensajeDe(e));
}

/**
 * ¿Es cosa del servidor o de la red —y no del archivo ni de los permisos—?
 * Esos fallos se van solos: vale la pena esperar y volver a intentar.
 */
export function esErrorTransitorio(e: unknown): boolean {
  const s = estadoHttp(e);
  if (s != null && ESTADOS_TRANSITORIOS.includes(s)) return true;
  // El 520 llega como texto genérico cuando el proxy devuelve HTML y el JSON no se pudo leer.
  if (esRuidoHttp(mensajeDe(e))) return true;
  return esFallaDeRed(e);
}

/**
 * El archivo YA está en el bucket: pasó cuando el primer intento llegó al
 * servidor y la respuesta se perdió en el camino. Cuenta como subida.
 */
export function esYaSubido(e: unknown): boolean {
  const o = (e && typeof e === 'object' ? e : {}) as { statusCode?: unknown; code?: unknown };
  const codigo = `${o.code ?? ''} ${o.statusCode ?? ''}`;
  if (/duplicate|409/i.test(codigo)) return true;
  return /already exists|ya existe|\bduplicate\b/i.test(mensajeDe(e));
}

/**
 * Texto claro para un error que NO explica nada (el «HTTP 520 error» del proxy
 * o una caída de red). `null` cuando el error trae una explicación propia:
 * ese se manda tal cual, con el detalle de Supabase.
 */
export function mensajeSubidaFallida(e: unknown, intentos = INTENTOS_SUBIDA): string | null {
  const s = estadoHttp(e);
  const original = mensajeDe(e).trim();
  if (s != null && ESTADOS_TRANSITORIOS.includes(s)) {
    const detalle = esRuidoHttp(original) ? '' : ` (${original})`;
    return `Supabase no contestó (error ${s})${detalle}: se intentó ${intentos} veces. Vuelve a intentarlo en unos segundos.`;
  }
  if (esFallaDeRed(e)) {
    return `Se perdió la conexión mientras se subía: se intentó ${intentos} veces. Revisa la internet y vuelve a intentarlo.`;
  }
  return null;
}

const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface OpcionesReintentoSubida {
  /** Cuántas veces se intenta (por defecto `INTENTOS_SUBIDA`). */
  intentos?: number;
  /** Cómo espera entre intentos. En las pruebas se inyecta una que no duerme. */
  espera?: (ms: number) => Promise<void>;
}

/**
 * Ejecuta `subir` —que debe lanzar si falló— reintentando SOLO ante un fallo
 * transitorio. Devuelve en cuanto sube, descarta el «ya existe» como éxito y
 * al final lanza: el mensaje claro si era cosa del servidor/red, y el error
 * original con su explicación si era otra cosa.
 */
export async function subirConReintento(subir: () => Promise<void>, opciones: OpcionesReintentoSubida = {}): Promise<void> {
  const intentos = Math.max(1, Math.trunc(opciones.intentos ?? INTENTOS_SUBIDA));
  const espera = opciones.espera ?? esperar;
  let ultimo: unknown = null;

  for (let intento = 1; intento <= intentos; intento++) {
    try {
      await subir();
      return;
    } catch (e) {
      ultimo = e;
      if (esYaSubido(e)) return;
      if (intento >= intentos || !esErrorTransitorio(e)) break;
      await espera(ESPERAS_SUBIDA_MS[Math.min(intento - 1, ESPERAS_SUBIDA_MS.length - 1)]);
    }
  }
  const claro = mensajeSubidaFallida(ultimo, intentos);
  // Texto propio solo si el del servidor no explica nada; si no, tal cual.
  if (claro) throw new Error(claro);
  throw ultimo;
}
