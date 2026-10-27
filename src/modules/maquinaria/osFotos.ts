/* ============================================================
   Golden Touch · Control de Maquinaria · Fotos de la orden de servicio
   Reglas puras (sin Supabase): cuántas fotos admite una orden, qué
   archivos se aceptan y dónde se guardan. Tabla `maquinaria_os_fotos`
   + bucket privado `maquinaria-os-fotos` (la base también exige el
   tope de 4 y la carpeta de la orden).
   ============================================================ */

/** Cada orden admite hasta 4 fotos (la base también lo exige con un trigger). */
export const MAX_FOTOS_ORDEN = 4;
/** Peso al que se apunta después de comprimir (JPG de ~1600 px). */
export const OBJETIVO_BYTES_FOTO = 1024 * 1024;
/** Tope duro del bucket: por encima, la foto no se sube. */
export const MAX_BYTES_FOTO = 2 * 1024 * 1024;
/** Tope del original, ANTES de comprimir: solo protege la memoria del teléfono. */
export const MAX_BYTES_ORIGINAL = 30 * 1024 * 1024;

/** Formatos que acepta el bucket (lo demás se convierte a JPG antes de subir). */
export const TIPOS_FOTO = ['image/jpeg', 'image/png', 'image/webp'];

const EXT_IMAGEN = /\.(jpe?g|png|webp|heic|heif|bmp|gif)$/i;

const aMB = (b: number) => (b / (1024 * 1024)).toLocaleString('es-VE', { maximumFractionDigits: 1 });

/** Controles ANTES de comprimir: que sea una imagen, que no esté vacía y que no sea enorme. */
export function errorFotoOriginal(file: { name: string; type: string; size: number }): string | null {
  const esImagen = file.type ? file.type.startsWith('image/') : EXT_IMAGEN.test(file.name);
  if (!esImagen) return `«${file.name}» no es una foto: elige una imagen (JPG o PNG).`;
  if (!(file.size > 0)) return `«${file.name}» está vacía.`;
  if (file.size > MAX_BYTES_ORIGINAL) return `«${file.name}» pesa ${aMB(file.size)} MB: el máximo es ${aMB(MAX_BYTES_ORIGINAL)} MB.`;
  return null;
}

/** Controles DESPUÉS de comprimir: formato que el bucket y el PDF entienden, y peso. */
export function errorFotoLista(file: { name: string; type: string; size: number }): string | null {
  if (!TIPOS_FOTO.includes(file.type)) {
    return `«${file.name}»: ese formato no se pudo convertir a JPG en este teléfono. Toma la foto de nuevo o elige una en JPG.`;
  }
  if (file.size > MAX_BYTES_FOTO) return `«${file.name}» quedó en ${aMB(file.size)} MB: el máximo es ${aMB(MAX_BYTES_FOTO)} MB.`;
  return null;
}

/**
 * De los archivos elegidos, cuáles caben en la orden (que ya tiene `actuales`):
 * se toman en orden hasta llenar las 4 y el resto se descarta con aviso.
 */
export function tomarHastaCupo<T>(actuales: number, archivos: T[]): { tomar: T[]; descartadas: number } {
  const libres = Math.max(0, MAX_FOTOS_ORDEN - Math.max(0, actuales));
  return { tomar: archivos.slice(0, libres), descartadas: Math.max(0, archivos.length - libres) };
}

/** Texto del aviso cuando se eligieron más fotos de las que caben. */
export function avisoCupo(descartadas: number): string | null {
  if (descartadas <= 0) return null;
  return descartadas === 1
    ? `Solo caben ${MAX_FOTOS_ORDEN} fotos por orden: una quedó fuera.`
    : `Solo caben ${MAX_FOTOS_ORDEN} fotos por orden: ${descartadas} quedaron fuera.`;
}

/** Primer puesto libre (1..4) entre los ocupados, o null si la orden está llena. */
export function puestoLibre(ocupados: number[]): number | null {
  for (let i = 1; i <= MAX_FOTOS_ORDEN; i++) if (!ocupados.includes(i)) return i;
  return null;
}

/** Ruta en el bucket: carpeta de la orden (la base lo exige), sello y nombre limpio. */
export function rutaFotoOrden(ordenId: string, sello: string, archivo: string): string {
  const limpio = (archivo || 'foto.jpg')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[^\w.-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(-60);
  return `${ordenId}/${sello}-${limpio}`;
}
