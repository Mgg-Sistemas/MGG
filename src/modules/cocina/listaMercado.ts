/* ============================================================
   MGG · Cocina · La lista física del mercado (05-10-2026)

   Al cerrar un mercado y arrancar el siguiente, o al iniciarlo a mano, se
   adjunta la lista en papel de lo que entró: hasta 4 FOTOS, o UN PDF. No las
   dos cosas: el PDF ya es el documento entero, y mezclarlo con fotos sueltas
   deja dos versiones de la misma lista sin saber cuál manda.

   La regla vive acá, pura, y la aplican tanto la pantalla como el guardado.
   ============================================================ */

export const MAX_FOTOS_LISTA_MERCADO = 4;

/** Lo mínimo que hace falta saber de un archivo (nuevo o ya guardado). */
export interface ArchivoLista {
  nombre: string;
  tipo?: string | null;
}

export function esPdfLista(a: ArchivoLista): boolean {
  return (a.tipo ?? '').toLowerCase() === 'application/pdf' || /\.pdf$/i.test(a.nombre ?? '');
}

export function esImagenLista(a: ArchivoLista): boolean {
  if ((a.tipo ?? '').toLowerCase().startsWith('image/')) return true;
  return /\.(jpe?g|png|webp|heic|heif|gif)$/i.test(a.nombre ?? '');
}

/**
 * ¿Se pueden sumar estos archivos a los que ya tiene el mercado? Devuelve el
 * reclamo en palabras, o null si está bien.
 */
export function errorListaMercado(nuevos: ArchivoLista[], existentes: ArchivoLista[] = []): string | null {
  for (const a of nuevos) {
    if (!esPdfLista(a) && !esImagenLista(a)) return `«${a.nombre}» no es una imagen ni un PDF.`;
  }
  const todos = [...existentes, ...nuevos];
  const pdfs = todos.filter(esPdfLista).length;
  const fotos = todos.length - pdfs;
  if (pdfs > 1) return 'La lista va en UN solo PDF. Quitá el que sobra.';
  if (pdfs === 1 && fotos > 0) {
    return existentes.length
      ? 'Este mercado ya tiene su lista: es un PDF o hasta 4 fotos, no las dos cosas. Quitá lo que hay para cambiarla.'
      : 'Es un PDF o hasta 4 fotos, no las dos cosas.';
  }
  if (fotos > MAX_FOTOS_LISTA_MERCADO) return `Caben hasta ${MAX_FOTOS_LISTA_MERCADO} fotos de la lista.`;
  return null;
}
