/* ============================================================
   MGG · Equipos · Documentos por equipo (Supabase)

   Tabla `maquinaria_documentos` (hasta 4 por equipo, un espacio por
   documento) + bucket PRIVADO `equipos-docs`. Los archivos no quedan
   públicos: se ven y se descargan con una URL firmada que dura 5 minutos.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { textoDeError } from '@/shared/lib/errores';
import { subirConReintento } from '@/shared/lib/storageReintento';
import { MAX_DOCS_EQUIPO, limpiarNombreDoc, nombreArchivoSeguro, nombreDescarga, validarArchivoDoc } from './documentosEquipo';

export const BUCKET_DOCS_EQUIPO = 'equipos-docs';
/** Mismo bucket, con el nombre que usan las pantallas de Flota y Servicio (13-10). */
export const BUCKET_DOCUMENTOS = BUCKET_DOCS_EQUIPO;
const TABLE = 'maquinaria_documentos';

export interface DocumentoEquipo {
  id: string;
  equipo_id: string;
  slot: number;
  nombre: string;
  path: string;
  filename: string;
  mime: string | null;
  size_bytes: number | null;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
  /* Los mismos datos con los nombres de Golden Touch (los calcula `conAlias`, no están en la base). */
  espacio: number;
  archivo: string | null;
  content_type: string | null;
  tamano: number | null;
  subido_por: string | null;
  subido_por_nombre: string | null;
}

/** Fila de la base + los alias que esperan las pantallas traídas de Golden Touch. */
function conAlias(r: Record<string, unknown>): DocumentoEquipo {
  const d = r as unknown as Omit<DocumentoEquipo, 'espacio' | 'archivo' | 'content_type' | 'tamano' | 'subido_por' | 'subido_por_nombre'>;
  return {
    ...d,
    espacio: Number(d.slot) || 0, archivo: d.filename ?? null, content_type: d.mime ?? null,
    tamano: d.size_bytes ?? null, subido_por: d.updated_by ?? d.created_by ?? null, subido_por_nombre: null,
  };
}

export async function listDocumentosEquipo(equipoId: string): Promise<DocumentoEquipo[]> {
  const { data, error } = await supabase.from(TABLE).select('*').eq('equipo_id', equipoId).order('slot', { ascending: true });
  if (error) throw new Error(textoDeError(error, 'No se pudieron leer los documentos del equipo.'));
  return ((data ?? []) as Record<string, unknown>[]).map(conAlias);
}

/** URL firmada (10 min) para ver un documento (nombre que usan las pantallas de Flota y Servicio). */
export async function urlDocumentoEquipo(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET_DOCS_EQUIPO).createSignedUrl(path, 60 * 10);
  if (error || !data) throw new Error(textoDeError(error, 'No se pudo abrir el documento.'));
  return data.signedUrl;
}

/** Rutas de los archivos de un equipo (antes de eliminar el equipo). */
export async function pathsDocumentosDeEquipo(equipoId: string): Promise<string[]> {
  const { data, error } = await supabase.from(TABLE).select('path').eq('equipo_id', equipoId);
  if (error) throw error;
  return ((data ?? []) as { path: string }[]).map((r) => r.path);
}

/** Borra archivos del bucket de documentos (los registros se van por la FK en cascada). */
export async function borrarArchivosDocumentos(paths: string[]): Promise<void> {
  if (!paths.length) return;
  await supabase.storage.from(BUCKET_DOCS_EQUIPO).remove(paths).catch(() => undefined);
}

/** Cuántos documentos tiene cada equipo (para el contador del botón 📁). */
export async function contarDocumentosPorEquipo(): Promise<Map<string, number>> {
  const { data, error } = await supabase.from(TABLE).select('equipo_id');
  if (error) throw new Error(textoDeError(error, 'No se pudieron contar los documentos.'));
  const m = new Map<string, number>();
  for (const r of (data ?? []) as Array<{ equipo_id: string }>) m.set(r.equipo_id, (m.get(r.equipo_id) ?? 0) + 1);
  return m;
}

async function subirArchivo(equipoId: string, slot: number, file: File): Promise<string> {
  const nonce = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
  const path = `${equipoId}/${slot}-${nonce}-${nombreArchivoSeguro(file.name)}`;
  // Con reintento ante los 520/503 intermitentes del Storage (ver storageReintento.ts).
  try {
    await subirConReintento(async () => {
      const { error } = await supabase.storage.from(BUCKET_DOCS_EQUIPO).upload(path, file, {
        contentType: file.type || 'application/pdf', upsert: false,
      });
      if (error) throw error;
    });
  } catch (e) {
    throw new Error(textoDeError(e, 'No se pudo subir el archivo.'));
  }
  return path;
}

async function borrarArchivo(path: string): Promise<void> {
  // Si falla, queda un archivo huérfano en el bucket; el documento ya se guardó bien.
  await supabase.storage.from(BUCKET_DOCS_EQUIPO).remove([path]).catch(() => undefined);
}

/**
 * Sube un documento a un espacio del equipo. Con `anterior` REEMPLAZA el archivo
 * de ese espacio (conserva el nombre que se indique) y borra el archivo viejo.
 */
export async function guardarDocumento(input: {
  equipoId: string; slot: number; nombre: string; file: File; actor: string; anterior?: DocumentoEquipo | null;
}): Promise<DocumentoEquipo> {
  const slot = Math.trunc(input.slot);
  if (slot < 1 || slot > MAX_DOCS_EQUIPO) throw new Error(`Cada equipo admite hasta ${MAX_DOCS_EQUIPO} documentos.`);
  const nombre = limpiarNombreDoc(input.nombre);
  if (!nombre) throw new Error('Elegí o escribí el nombre del documento.');
  const invalido = validarArchivoDoc(input.file);
  if (invalido) throw new Error(invalido);

  const path = await subirArchivo(input.equipoId, slot, input.file);
  const campos = {
    nombre, path, filename: input.file.name, mime: input.file.type || null, size_bytes: input.file.size,
    updated_by: input.actor, updated_at: new Date().toISOString(),
  };

  if (input.anterior) {
    const { data, error } = await supabase.from(TABLE).update(campos).eq('id', input.anterior.id).select('*').single();
    if (error) { await borrarArchivo(path); throw new Error(textoDeError(error, 'No se pudo cambiar el archivo.')); }
    await borrarArchivo(input.anterior.path);
    return conAlias(data as Record<string, unknown>);
  }

  const { data, error } = await supabase.from(TABLE)
    .insert({ ...campos, equipo_id: input.equipoId, slot, created_by: input.actor })
    .select('*').single();
  if (error) {
    await borrarArchivo(path);
    if ((error as { code?: string }).code === '23505') throw new Error(`El documento ${slot} ya está cargado. Recargá la ventana.`);
    throw new Error(textoDeError(error, 'No se pudo guardar el documento.'));
  }
  return conAlias(data as Record<string, unknown>);
}

/** Cambia solo el nombre del documento (el archivo queda igual). */
export async function renombrarDocumento(id: string, nombre: string, actor: string): Promise<void> {
  const n = limpiarNombreDoc(nombre);
  if (!n) throw new Error('El nombre no puede quedar vacío.');
  const { error } = await supabase.from(TABLE).update({ nombre: n, updated_by: actor, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error(textoDeError(error, 'No se pudo cambiar el nombre.'));
}

/** Elimina el documento y su archivo. El espacio queda libre. */
export async function eliminarDocumento(doc: DocumentoEquipo): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq('id', doc.id);
  if (error) throw new Error(textoDeError(error, 'No se pudo eliminar el documento.'));
  await borrarArchivo(doc.path);
}

/** URL firmada (5 min) para la vista previa. */
export async function urlVerDocumento(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET_DOCS_EQUIPO).createSignedUrl(path, 300);
  if (error || !data) throw new Error(textoDeError(error, 'No se pudo abrir el documento.'));
  return data.signedUrl;
}

/** URL firmada (5 min) que descarga el archivo con el nombre del documento. */
export async function urlDescargaDocumento(doc: DocumentoEquipo): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET_DOCS_EQUIPO)
    .createSignedUrl(doc.path, 300, { download: nombreDescarga(doc.nombre, doc.filename) });
  if (error || !data) throw new Error(textoDeError(error, 'No se pudo descargar el documento.'));
  return data.signedUrl;
}
