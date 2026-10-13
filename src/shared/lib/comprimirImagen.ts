/* ============================================================
   MGG · Achicar una foto antes de subirla

   Una foto de celular pesa 3 a 8 MB. Con la señal de la mina, cada una tardaba
   un minuto en subir y el botón quedaba en «Guardando…» como si se hubiera
   trabado. Para un contador, un equipo o un vale alcanza con 1600 px de lado
   en JPEG: queda en unos 200–400 KB y sube en segundos.

   Si algo falla (formato raro, navegador viejo), se sube la foto original tal
   cual: achicar es una mejora, nunca un motivo para no guardar.
   ============================================================ */

/** Lado mayor de la foto achicada, en píxeles. */
export const LADO_MAXIMO = 1600;
/** Calidad JPEG (0–1). 0,82 no se nota a ojo y pesa una fracción. */
export const CALIDAD_JPEG = 0.82;
/** Por debajo de este peso no vale la pena tocar la foto. */
export const UMBRAL_BYTES = 400 * 1024;

/**
 * Formatos que hay que pasar a JPEG SIEMPRE, pesen lo que pesen: jsPDF solo
 * sabe dibujar JPEG y PNG, así que un WEBP guardado tal cual no se puede
 * anexar a un PDF (en Minutas terminaba listado como «no incluido»).
 */
export function debeConvertirSiempre(tipo: string): boolean {
  return tipo === 'image/webp';
}

/** ¿Es una imagen que conviene achicar? (GIF y SVG no: se romperían.) */
export function convieneAchicar(tipo: string, bytes: number): boolean {
  if (!tipo.startsWith('image/')) return false;
  if (tipo === 'image/gif' || tipo === 'image/svg+xml') return false;
  if (debeConvertirSiempre(tipo)) return true;   // por formato, no por peso
  return bytes > UMBRAL_BYTES;
}

/** Tamaño destino manteniendo la proporción; nunca agranda. */
export function medidasAchicadas(ancho: number, alto: number, maximo = LADO_MAXIMO): { ancho: number; alto: number } {
  const escala = Math.min(1, maximo / Math.max(ancho, alto, 1));
  return { ancho: Math.max(1, Math.round(ancho * escala)), alto: Math.max(1, Math.round(alto * escala)) };
}

/** Nombre con extensión .jpg (la foto achicada siempre sale en JPEG). */
export function nombreJpg(nombre: string): string {
  const base = nombre.replace(/\.[^.]+$/, '') || 'foto';
  return `${base}.jpg`;
}

/** Carga una imagen (File o Blob) respetando la rotación EXIF; sirve para achicarla o para dibujarla en un PDF. */
export async function cargarImagenDesdeBlob(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    // `imageOrientation: 'from-image'` respeta la rotación EXIF de la cámara.
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions); }
    catch { /* sigue con <img> */ }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen')); };
    img.src = url;
  });
}

/** Devuelve la foto achicada en JPEG, o la original si no hace falta o no se pudo. */
export async function comprimirImagen(file: File): Promise<File> {
  if (!convieneAchicar(file.type, file.size)) return file;
  if (typeof document === 'undefined') return file;
  try {
    const img = await cargarImagenDesdeBlob(file);
    const { ancho, alto } = medidasAchicadas(img.width, img.height);
    const canvas = document.createElement('canvas');
    canvas.width = ancho; canvas.height = alto;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, ancho, alto);
    if ('close' in img && typeof img.close === 'function') img.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', CALIDAD_JPEG));
    if (!blob) return file;
    // Un WEBP se queda en JPEG aunque pese más: acá el objetivo no es el peso,
    // es que el PDF pueda dibujarlo.
    if (blob.size >= file.size && !debeConvertirSiempre(file.type)) return file;
    return new File([blob], nombreJpg(file.name), { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    return file;
  }
}
