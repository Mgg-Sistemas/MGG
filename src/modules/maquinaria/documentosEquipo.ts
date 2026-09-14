/* ============================================================
   MGG · Equipos · Documentos por equipo (reglas puras)

   Los documentos de cada equipo (contrato, ficha técnica, póliza…)
   estaban en Drive y pasan al sistema. Cada equipo tiene hasta 4
   espacios; cada espacio es independiente: se sube, se ve, se cambia
   y se elimina solo. Los nombres salen de un catálogo que se va
   llenando para reutilizarlos la próxima vez.
   ============================================================ */

/** Máximo de documentos por equipo. */
export const MAX_DOCS_EQUIPO = 4;

/** Tamaño máximo por archivo (lo mismo limita el bucket en Supabase). */
export const MAX_BYTES_DOC = 15 * 1024 * 1024;

/** `accept` del input de archivo. */
export const ACEPTA_DOC = 'application/pdf,image/*';

/** Nombre del documento como se guarda: sin espacios de sobra y en mayúsculas. */
export function limpiarNombreDoc(nombre: string | null | undefined): string {
  return (nombre ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
}

/** Los 4 espacios del equipo, cada uno con su documento o vacío. */
export function slotsDeEquipo<T extends { slot: number }>(docs: T[]): Array<{ slot: number; doc: T | null }> {
  return Array.from({ length: MAX_DOCS_EQUIPO }, (_, i) => {
    const slot = i + 1;
    return { slot, doc: docs.find((d) => d.slot === slot) ?? null };
  });
}

/** Motivo por el que el archivo no se acepta, o null si está bien. */
export function validarArchivoDoc(file: { type: string; size: number; name: string }): string | null {
  const esPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const esImagen = file.type.startsWith('image/');
  if (!esPdf && !esImagen) return 'El documento debe ser un PDF o una imagen.';
  if (file.size > MAX_BYTES_DOC) return 'El archivo no puede superar 15 MB.';
  if (file.size <= 0) return 'El archivo está vacío.';
  return null;
}

/** Nombre de archivo apto para la ruta del bucket. */
export function nombreArchivoSeguro(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80) || 'documento';
}

/** Nombre con que se descarga: el del documento + la extensión del archivo subido. */
export function nombreDescarga(nombreDoc: string, filename: string): string {
  const ext = (filename.match(/\.[a-zA-Z0-9]{1,5}$/)?.[0] ?? '').toLowerCase();
  const base = nombreArchivoSeguro(limpiarNombreDoc(nombreDoc) || 'DOCUMENTO').replace(/\.[a-zA-Z0-9]{1,5}$/, '');
  return `${base}${ext}`;
}
