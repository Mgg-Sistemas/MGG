/* ============================================================
   MGG · RRHH · Minutas · adjuntos

   Fotos y escaneos de la minuta firmada. Viven en un almacén PRIVADO:
   no hay enlace público, cada vez que se abre uno se pide un enlace
   firmado que dura diez minutos. Mismo esquema que la documentación
   del personal (`personal-documentos`).
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { comprimirImagen } from '@/shared/lib/comprimirImagen';
import type { MinutaAdjunto } from '@/shared/lib/types';

const TABLE = 'minuta_adjuntos';
const BUCKET = 'minutas-adjuntos';
/** Máximo del archivo que se SUBE (ya comprimido): protege el almacén. */
export const MAX_BYTES_ADJUNTO = 10 * 1024 * 1024;
/** Tope del original ANTES de comprimir: solo protege la memoria al decodificar. */
export const MAX_BYTES_ORIGINAL = 50 * 1024 * 1024;
export const ACEPTA_ADJUNTO = 'image/jpeg,image/png,image/webp,application/pdf';

const TIPOS_OK = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

const aMB = (bytes: number) => bytes / 1024 / 1024;
const EXT_POR_TIPO: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/** Ruta en el almacén: `minutaId/uuid.ext`. La extensión sale del tipo, nunca del nombre. */
export function rutaAdjunto(minutaId: string, tipo: string, uuid: string): string {
  return `${minutaId}/${uuid}.${EXT_POR_TIPO[tipo] ?? 'bin'}`;
}

const MENSAJE_VACIO = 'El archivo está vacío (0 bytes). Revisá que no esté dañado.';

/**
 * Controles que se pueden hacer ANTES de comprimir: tipo, vacío y un tope
 * duro sobre el original. El límite de 10 MB NO se mide acá sino sobre lo
 * que se sube (ver `errorArchivoSubible`): una foto de teléfono de 12 MB
 * comprimida pesa ~300 kB y debe poder subirse. `null` = está bien.
 */
export function errorArchivoAdjunto(file: File): string | null {
  if (!TIPOS_OK.includes(file.type)) {
    return 'Solo se aceptan imágenes JPG, PNG o WEBP, y archivos PDF.';
  }
  // Un archivo de 0 bytes es un archivo corrupto o vacío: no tiene nada que guardar.
  if (file.size === 0) return MENSAJE_VACIO;
  if (file.size > MAX_BYTES_ORIGINAL) {
    return `El archivo pesa ${aMB(file.size).toFixed(1)} MB y el máximo antes de comprimir es ${aMB(MAX_BYTES_ORIGINAL)} MB.`;
  }
  return null;
}

/** Control sobre el archivo que realmente se va a subir (ya comprimido). `null` = está bien. */
export function errorArchivoSubible(file: File): string | null {
  if (file.size === 0) return MENSAJE_VACIO;
  if (file.size > MAX_BYTES_ADJUNTO) {
    return `El archivo, tal como se va a guardar, pesa ${aMB(file.size).toFixed(1)} MB y el máximo es ${aMB(MAX_BYTES_ADJUNTO)} MB.`;
  }
  return null;
}

export async function listAdjuntos(minutaId: string): Promise<MinutaAdjunto[]> {
  const { data, error } = await supabase
    .from(TABLE).select('*').eq('minuta_id', minutaId).order('subido_en', { ascending: true });
  if (error) throw error;
  return (data ?? []) as MinutaAdjunto[];
}

export async function subirAdjunto(minutaId: string, file: File, actor: string): Promise<MinutaAdjunto> {
  const problema = errorArchivoAdjunto(file);
  if (problema) throw new Error(problema);

  // Orden: (1) tope de 50 MB sobre el original, solo para no decodificar en
  // memoria algo absurdo; (2) se comprime; (3) el límite de 10 MB se mide sobre
  // el archivo comprimido, que es el que ocupa lugar en el almacén.
  const subir = await comprimirImagen(file);
  const problemaFinal = errorArchivoSubible(subir);
  if (problemaFinal) throw new Error(problemaFinal);
  const path = rutaAdjunto(minutaId, subir.type, crypto.randomUUID());

  const { error: upErr } = await supabase.storage.from(BUCKET)
    .upload(path, subir, { contentType: subir.type, upsert: false });
  if (upErr) throw upErr;

  const { data, error } = await supabase.from(TABLE).insert({
    minuta_id: minutaId,
    nombre: file.name,
    path,
    tipo: subir.type,
    bytes: subir.size,
    subido_por: actor,
  }).select('*').single();

  // Si la fila no se pudo escribir, el archivo huérfano se borra: no se deja basura.
  if (error) {
    // La librería no lanza: devuelve `{ error }`.
    const { error: errLimpieza } = await supabase.storage.from(BUCKET).remove([path]);
    if (errLimpieza) console.warn('No se pudo limpiar el archivo huérfano:', path, errLimpieza);
    throw error;
  }
  return data as MinutaAdjunto;
}

export async function borrarAdjunto(a: MinutaAdjunto): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq('id', a.id);
  if (error) throw error;
  // La librería NO lanza: devuelve `{ error }`. Un `.catch` aquí nunca se activaría.
  const { error: errAlmacen } = await supabase.storage.from(BUCKET).remove([a.path]);
  if (errAlmacen) console.warn('No se pudo borrar el archivo del almacén:', a.path, errAlmacen);
}

/**
 * Borra del almacén todo lo que cuelga de una minuta. Lista el bucket (no la
 * tabla) para recoger también cualquier huérfano viejo. Se llama DESPUÉS de
 * borrar la fila: la base borra los adjuntos por cascade, pero los archivos no.
 * Un fallo se avisa por consola y no lanza: la minuta ya no existe.
 */
export async function borrarArchivosDeMinuta(minutaId: string): Promise<void> {
  const { data, error } = await supabase.storage.from(BUCKET).list(minutaId, { limit: 1000 });
  if (error) { console.warn('No se pudieron listar los archivos de la minuta:', minutaId, error); return; }
  const rutas = (data ?? []).map((f) => `${minutaId}/${f.name}`);
  if (rutas.length === 0) return;
  const { error: errBorrado } = await supabase.storage.from(BUCKET).remove(rutas);
  if (errBorrado) console.warn('No se pudieron borrar los archivos de la minuta:', rutas, errBorrado);
}

export async function urlAdjunto(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 600);
  if (error) throw error;
  return data.signedUrl;
}
