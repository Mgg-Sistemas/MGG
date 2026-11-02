/* ============================================================
   MGG · Las fotos viajan con el aviso de WhatsApp (02-11-2026)

   Pedido de la administradora: «las fotos que se toman en la salida tienen
   que salir en el mensaje de WhatsApp». Un enlace `wa.me/?text=…` o
   `api.whatsapp.com/send` SOLO lleva texto: no hay forma de meterle una
   imagen. Las fotos se mandan de verdad por la hoja de compartir del sistema
   (`navigator.share({ files, text })`): en Android, iOS y en Chrome/Edge de
   Windows se elige WhatsApp y las fotos llegan con el texto debajo.

   Donde el navegador no sabe adjuntar archivos (Firefox de PC, navegadores
   viejos) el mensaje lleva un renglón por foto con su enlace firmado: al
   menos se ven desde el chat, y valen 7 días.

   Aquí vive lo que no depende de la pantalla, para poder probarlo.
   ============================================================ */

/** Cuánto vive el enlace de una foto que va dentro del mensaje: 7 días, en segundos. */
export const SEGUNDOS_ENLACE_FOTO = 7 * 24 * 60 * 60;

/**
 * Cómo sale el mensaje al tocar «Enviar por WhatsApp»:
 * · `archivos`: hoja de compartir con las fotos adjuntas y el texto.
 * · `texto`: hoja de compartir solo con el texto (lleva los enlaces de las fotos).
 * · `enlace`: el enlace de WhatsApp de siempre (también con los enlaces de las fotos).
 */
export type ModoEnvioWhatsapp = 'archivos' | 'texto' | 'enlace';

export function modoEnvioWhatsapp(o: { hayFotos: boolean; adjuntaArchivos: boolean; hojaCompartir: boolean }): ModoEnvioWhatsapp {
  if (o.hayFotos && o.adjuntaArchivos) return 'archivos';
  return o.hojaCompartir ? 'texto' : 'enlace';
}

/** Lo mínimo de `navigator` que hace falta para saber si se pueden adjuntar archivos. */
export interface NavegadorCompartir {
  share?: unknown;
  canShare?: (datos: { files?: File[] }) => boolean;
}

/**
 * ¿Este navegador adjunta estas fotos al compartir? `canShare` puede lanzar
 * (o no existir) en navegadores viejos: cualquier duda es un «no».
 */
export function adjuntaArchivos(nav: NavegadorCompartir | null | undefined, archivos: File[]): boolean {
  if (!nav || !archivos.length) return false;
  if (typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false;
  try { return nav.canShare({ files: archivos }) === true; } catch { return false; }
}

/**
 * El mensaje con un renglón por foto (su enlace). Se usa cuando las fotos NO
 * pueden ir adjuntas. Sin enlaces, el texto queda igual.
 */
export function textoConEnlacesDeFotos(texto: string, enlaces: readonly string[]): string {
  const validos = enlaces.map((u) => (u ?? '').trim()).filter(Boolean);
  if (!validos.length) return texto;
  const lineas = validos.length === 1
    ? ['📷 *Foto:*', validos[0]]
    : ['📷 *Fotos:*', ...validos.map((u, i) => `${i + 1}. ${u}`)];
  return [texto.trimEnd(), '', ...lineas].join('\n');
}

const EXTENSION_POR_TIPO: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
};
const TIPO_POR_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
};

/**
 * Tipo de la foto: el que trae el archivo o, si viene vacío (pasa con lo que
 * se baja del depósito), el que dice la extensión. Por defecto JPEG, que es
 * en lo que quedan las fotos achicadas.
 */
export function tipoDeFoto(tipo: string | null | undefined, nombre: string): string {
  if (tipo && tipo.startsWith('image/')) return tipo;
  const ext = /\.([a-z0-9]+)$/i.exec(nombre)?.[1]?.toLowerCase() ?? '';
  return TIPO_POR_EXTENSION[ext] ?? 'image/jpeg';
}

/**
 * Nombre con que la foto se entrega a WhatsApp. La extensión TIENE que
 * coincidir con el tipo: Chrome rechaza el archivo entero (`canShare` da
 * falso) si se llama «IMG_0001.HEIC» pero adentro es un JPEG ya achicado.
 */
export function nombreFotoCompartir(nombre: string | null | undefined, tipo: string, posicion: number): string {
  const base = (nombre ?? '').replace(/\.[^./\\]*$/, '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
  const ext = EXTENSION_POR_TIPO[tipo] ?? 'jpg';
  return `${base || `foto-${posicion + 1}`}.${ext}`;
}
