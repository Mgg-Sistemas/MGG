/* ============================================================
   MGG · Salidas · Adjuntos de la solicitud

   Hasta cuatro papeles por solicitud de salida, traslado o salida temporal:
   la foto del material que sale, la nota firmada, el presupuesto del taller,
   el remito que devolvió el destino. Imagen o PDF.

   Las reglas viven acá, sin base de datos y sin pantalla, para poder probarlas.

   POR QUÉ CUATRO
   Es el mismo tope que las imágenes de referencia de una Solicitud de Pedido.
   No es una limitación técnica: una solicitud con doce fotos deja de servir
   para encontrar la que importa, y el que aprueba las mira desde el teléfono.

   POR QUÉ SOLO IMAGEN O PDF
   Son cosas que se miran de un vistazo al aprobar. Un .docx o un .zip habría
   que bajarlo y abrirlo aparte, que es justamente lo que se quiere evitar.

   POR QUÉ EL DEPÓSITO ES PRIVADO
   Una nota de salida lleva quién retiró, con qué vehículo y hacia dónde. No
   va a un depósito público: se abre con un enlace que caduca a los 10 minutos.
   ============================================================ */

/** Un adjunto ya guardado: dónde está y con qué nombre se subió. */
export interface AdjuntoSalida {
  path: string;
  filename: string;
}

/** Tope por solicitud. Ver el encabezado. */
export const MAX_ADJUNTOS_SALIDA = 4;

/** Tope de tamaño por archivo. Es el mismo del bucket. */
export const MAX_BYTES_ADJUNTO = 15 * 1024 * 1024;

export interface ArchivoAdjunto {
  name: string;
  type: string;
  size: number;
}

/** ¿Es PDF? Se mira el tipo declarado y, si viene vacío, la extensión. */
export function esPdfAdjunto(f: Pick<ArchivoAdjunto, 'name' | 'type'>): boolean {
  return f.type === 'application/pdf' || /\.pdf$/i.test(f.name ?? '');
}

/**
 * ¿Es imagen? Igual: tipo declarado, y si no, la extensión.
 *
 * La extensión hace falta de verdad: Android y iOS mandan `type` vacío en
 * buena parte de las fotos tomadas desde la cámara del navegador, y sin esto
 * la foto del material se rechazaría justo en el caso más común.
 */
export function esImagenAdjunto(f: Pick<ArchivoAdjunto, 'name' | 'type'>): boolean {
  if ((f.type ?? '').startsWith('image/')) return true;
  return /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)$/i.test(f.name ?? '');
}

/** «2,4 MB» / «812 KB», para decir el tamaño sin hacer pensar al lector. */
export function pesoAdjunto(bytes: unknown): string {
  const b = Number(bytes) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(Math.round((b / (1024 * 1024)) * 10) / 10).toLocaleString('es-VE')} MB`;
}

/**
 * Qué está mal con UN archivo, en palabras. `null` si se puede subir.
 * No lanza: el formulario quiere mostrarlo, no explotar.
 */
export function validarArchivoAdjunto(f: ArchivoAdjunto | null | undefined): string | null {
  if (!f) return 'Elegí un archivo.';
  if (!f.name?.trim()) return 'El archivo no tiene nombre.';
  if (!esPdfAdjunto(f) && !esImagenAdjunto(f)) {
    return `«${f.name}»: solo se aceptan imágenes (JPG, PNG, HEIC…) o PDF.`;
  }
  if (Number(f.size) <= 0) return `«${f.name}» está vacío.`;
  if (Number(f.size) > MAX_BYTES_ADJUNTO) {
    return `«${f.name}» pesa ${pesoAdjunto(f.size)} y el tope es 15 MB. Si es una foto, sacala con menos resolución.`;
  }
  return null;
}

export function archivoAdjuntoValido(f: ArchivoAdjunto | null | undefined): boolean {
  return validarArchivoAdjunto(f) === null;
}

/** Cuántos quedan cargados: los que ya estaban menos los que se van a quitar. */
export function adjuntosQueQuedan(
  existentes: readonly AdjuntoSalida[] = [],
  quitar: readonly string[] = [],
): AdjuntoSalida[] {
  return existentes.filter((a) => !quitar.includes(a.path));
}

/** Cuánto lugar queda libre. Nunca negativo. */
export function cupoAdjuntos(
  existentes: readonly AdjuntoSalida[] = [],
  quitar: readonly string[] = [],
  nuevos = 0,
): number {
  return Math.max(0, MAX_ADJUNTOS_SALIDA - adjuntosQueQuedan(existentes, quitar).length - nuevos);
}

/**
 * Qué está mal con la tanda completa. `null` si se puede guardar.
 *
 * Se revisa el conjunto y no archivo por archivo porque el error típico no es
 * un archivo malo: es elegir cinco de una sola vez cuando ya había dos.
 */
export function validarTandaAdjuntos(
  nuevos: readonly ArchivoAdjunto[],
  existentes: readonly AdjuntoSalida[] = [],
  quitar: readonly string[] = [],
): string | null {
  for (const f of nuevos) {
    const malo = validarArchivoAdjunto(f);
    if (malo) return malo;
  }
  const quedan = adjuntosQueQuedan(existentes, quitar).length;
  if (quedan + nuevos.length > MAX_ADJUNTOS_SALIDA) {
    return `Son ${MAX_ADJUNTOS_SALIDA} adjuntos como máximo por solicitud. Ya hay ${quedan} y estás agregando ${nuevos.length}.`;
  }
  return null;
}

/**
 * Los archivos que SÍ entran, recortados al cupo.
 *
 * El formulario ya avisa cuando se pasan, pero el repositorio igual recorta:
 * si alguien manda cinco por otro camino, se guardan cuatro en vez de que la
 * base rechace el update entero y la solicitud se quede sin ningún adjunto.
 */
export function recortarAlCupo<T>(
  nuevos: readonly T[],
  existentes: readonly AdjuntoSalida[] = [],
  quitar: readonly string[] = [],
): T[] {
  return nuevos.slice(0, cupoAdjuntos(existentes, quitar));
}

/** El nombre, limpio de lo que rompe una ruta de Storage. */
export function nombreSeguroAdjunto(nombre: string): string {
  const limpio = String(nombre ?? '').replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_');
  return limpio.replace(/^_+|_+$/g, '') || 'adjunto';
}

/** El ícono que le toca en el listado. */
export function iconoAdjunto(a: Pick<AdjuntoSalida, 'filename'>): string {
  return /\.pdf$/i.test(a.filename ?? '') ? '📄' : '🖼';
}

/** «2 adjuntos» / «1 adjunto» / «—», para la fila del listado. */
export function resumenAdjuntos(lista: readonly AdjuntoSalida[] | null | undefined): string {
  const n = (lista ?? []).length;
  if (!n) return '—';
  return `${n} ${n === 1 ? 'adjunto' : 'adjuntos'}`;
}

/** Lo que llega de la base puede ser cualquier cosa: se deja en forma. */
export function adjuntosDeFila(v: unknown): AdjuntoSalida[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => {
      const o = (x ?? {}) as Record<string, unknown>;
      const path = String(o.path ?? '').trim();
      return path ? { path, filename: String(o.filename ?? '').trim() || path.split('/').pop() || 'adjunto' } : null;
    })
    .filter((x): x is AdjuntoSalida => x !== null)
    .slice(0, MAX_ADJUNTOS_SALIDA);
}
