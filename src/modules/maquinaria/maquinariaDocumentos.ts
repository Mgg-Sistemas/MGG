/* ============================================================
   Golden Touch · Control de Maquinaria · Documentos del equipo
   Reglas puras (sin Supabase): cuántos documentos admite un equipo,
   qué archivos se aceptan, cómo se nombran y dónde se guardan.
   ============================================================ */

/** Cada equipo tiene hasta 20 espacios de documento (la base también lo exige; antes del 16/10/2026 eran 4). */
export const MAX_DOCUMENTOS_EQUIPO = 20;
/** Tope por archivo (igual al del bucket). */
export const MAX_MB_DOCUMENTO = 50;

const TIPOS_ACEPTADOS = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const EXTENSIONES_ACEPTADAS = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif'];

/** Valor para el atributo `accept` de los selectores de archivo. */
export const ACCEPT_DOCUMENTO = TIPOS_ACEPTADOS.join(',');

function extension(nombre: string | null | undefined): string {
  const m = /\.([a-z0-9]+)$/i.exec(nombre ?? '');
  return m ? m[1].toLowerCase() : '';
}

/** Nombre del documento como se guarda en el catálogo: MAYÚSCULA y sin espacios de sobra. */
export function normalizarNombreDocumento(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
}

/** Peso del archivo en palabras: «850 KB», «12,4 MB». */
export function tamanoLegible(bytes: number | null | undefined): string {
  const b = Math.max(0, Number(bytes) || 0);
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / (1024 * 1024)).toLocaleString('es-VE', { maximumFractionDigits: 1 })} MB`;
}

/** Devuelve el problema del archivo, o null si se puede subir. */
export function validarArchivoDocumento(file: { name: string; type: string; size: number }): string | null {
  // Algunos navegadores no informan el tipo: se decide por la extensión.
  const tipoOk = file.type ? TIPOS_ACEPTADOS.includes(file.type) : EXTENSIONES_ACEPTADAS.includes(extension(file.name));
  if (!tipoOk) return `«${file.name}»: tiene que ser un PDF o una imagen (PNG, JPG, WEBP o GIF).`;
  if (!(file.size > 0)) return `«${file.name}» está vacío.`;
  if (file.size > MAX_MB_DOCUMENTO * 1024 * 1024) {
    return `«${file.name}» pesa ${tamanoLegible(file.size)}: el máximo es ${MAX_MB_DOCUMENTO} MB.`;
  }
  return null;
}

/** Ruta del archivo en el bucket: carpeta del equipo, espacio, sello y nombre limpio. */
export function rutaDocumento(equipoId: string, espacio: number, archivo: string, sello: string): string {
  const limpio = (archivo || 'documento')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[^\w.-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(-80);
  return `${equipoId}/${espacio}-${sello}-${limpio}`;
}

/** Los 4 espacios del equipo, cada uno con su documento o vacío. */
export function espaciosDocumentos<T extends { espacio: number }>(docs: T[]): { espacio: number; doc: T | null }[] {
  return Array.from({ length: MAX_DOCUMENTOS_EQUIPO }, (_, i) => ({
    espacio: i + 1,
    doc: docs.find((d) => d.espacio === i + 1) ?? null,
  }));
}

/** Nombre con el que se descarga: el nombre del documento y la extensión del archivo. */
export function nombreDescargaDocumento(nombre: string, archivo: string | null | undefined): string {
  const base = normalizarNombreDocumento(nombre).replace(/[\\/:*?"<>|]+/g, '-') || 'DOCUMENTO';
  return `${base}.${extension(archivo) || 'pdf'}`;
}

/**
 * Los espacios que se muestran: los que tienen documento y UN espacio libre (el
 * primero) para cargar el siguiente. Con 20 espacios, mostrarlos todos vacíos
 * llenaba la ventana de tarjetas en blanco.
 */
export function espaciosVisibles<T extends { espacio: number }>(docs: T[]): { espacio: number; doc: T | null }[] {
  const todos = espaciosDocumentos(docs);
  const libre = todos.find((e) => !e.doc);
  return todos.filter((e) => e.doc || e === libre);
}

/** ¿Es la foto principal del equipo? «FOTO DEL EQUIPO», «FOTO EQUIPO», «Foto del equipo 2»… */
export function esFotoDelEquipo(nombre: string | null | undefined): boolean {
  return /^FOTO (DEL )?EQUIPO\b/.test(normalizarNombreDocumento(nombre).normalize('NFD').replace(/\p{Diacritic}/gu, ''));
}

/**
 * Orden de las fotos del equipo (16/10/2026): primero las que se llaman «FOTO
 * DEL EQUIPO» (la primera es la que se ve en el expediente, el catálogo y la
 * ficha PDF); después el resto, en el orden de sus espacios. Orden estable.
 */
export function ordenarFotosEquipo<T extends { nombre: string }>(fotos: T[]): T[] {
  return [...fotos.filter((f) => esFotoDelEquipo(f.nombre)), ...fotos.filter((f) => !esFotoDelEquipo(f.nombre))];
}

/** Primer espacio libre del equipo, o null si están todos ocupados. */
export function espacioLibre(docs: { espacio: number }[]): number | null {
  return espaciosDocumentos(docs).find((e) => !e.doc)?.espacio ?? null;
}

/**
 * Nombre de una foto subida desde la tarjeta del equipo (16/10/2026): la primera
 * es «FOTO DEL EQUIPO»; las siguientes, «FOTO DEL EQUIPO 2», «… 3»…
 */
export function nombreFotoEquipo(docs: { nombre: string }[]): string {
  const base = 'FOTO DEL EQUIPO';
  const usados = new Set(docs.map((d) => normalizarNombreDocumento(d.nombre)));
  if (!usados.has(base)) return base;
  let n = 2;
  while (usados.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}
