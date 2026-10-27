/* ============================================================
   Golden Touch · Mandar un texto por WhatsApp

   Lo usan los avisos que se arman en el teléfono (el surtido de combustible,
   la comida servida). Vive aquí, sin pantalla, para poder probarlo.
   ============================================================ */

/**
 * Enlace de WhatsApp con el mensaje ya escrito (abre la app o WhatsApp Web).
 *
 * Se limpia el selector invisible U+FE0F por si alguna vez se cuela: WhatsApp
 * lo descarta igual y, cuando queda a medias, el emoji llega como cuadrito.
 * Mejor mandar el carácter solo, que es lo que el teléfono sabe pintar.
 */
export function enlaceWhatsapp(texto: string): string {
  return `https://wa.me/?text=${encodeURIComponent(sinSelectorDeEmoji(texto))}`;
}

/** Quita el selector de presentación de emoji (U+FE0F), que WhatsApp pierde. */
export function sinSelectorDeEmoji(texto: string): string {
  return texto.replace(/️/g, '');
}
