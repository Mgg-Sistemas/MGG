/* ============================================================
   Golden Touch · Control de Maquinaria · Documentos del equipo
   Hasta 4 documentos por equipo (contrato, catálogo, póliza…), cada uno
   en su ESPACIO (1..4) e independiente de los demás. Tabla
   `maquinaria_documentos` + bucket privado `maquinaria-documentos`.
   Los nombres se guardan tipo catálogo (maquinaria_catalogos, tipo
   'documento') para reusarlos la próxima vez.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { addCatalogoMaquinaria } from './maquinaria.repository';
import { MAX_DOCUMENTOS_EQUIPO, normalizarNombreDocumento, rutaDocumento, validarArchivoDocumento } from './maquinariaDocumentos';

export const BUCKET_DOCUMENTOS = 'equipos-docs'; // MGG: el bucket de siempre (en GT se llama maquinaria-documentos)
const TABLE = 'maquinaria_documentos';

export interface DocumentoEquipo {
  id: string;
  equipo_id: string;
  espacio: number;
  nombre: string;
  path: string;
  archivo: string | null;
  content_type: string | null;
  tamano: number | null;
  subido_por: string | null;
  subido_por_nombre: string | null;
  created_at: string;
  updated_at: string | null;
}

/** Documentos de un equipo, por espacio. */
export async function listDocumentosEquipo(equipoId: string): Promise<DocumentoEquipo[]> {
  const { data, error } = await supabase.from(TABLE).select('*')
    .eq('equipo_id', equipoId)
    .order('espacio', { ascending: true });
  if (error) throw error;
  return (data ?? []) as DocumentoEquipo[];
}

/** Cuántos documentos tiene cada equipo (para el contador del botón 📎). */
export async function contarDocumentosPorEquipo(): Promise<Map<string, number>> {
  const { data, error } = await supabase.from(TABLE).select('equipo_id');
  if (error) throw error;
  const m = new Map<string, number>();
  for (const r of (data ?? []) as { equipo_id: string }[]) m.set(r.equipo_id, (m.get(r.equipo_id) ?? 0) + 1);
  return m;
}

/** El nombre queda en el catálogo para la próxima vez. Si ya estaba, no pasa nada. */
async function guardarNombreEnCatalogo(nombre: string): Promise<void> {
  try { await addCatalogoMaquinaria('documento', nombre); } catch { /* ya existe: el documento igual se guarda */ }
}

async function borrarDelBucket(paths: string[]): Promise<void> {
  if (!paths.length) return;
  try { await supabase.storage.from(BUCKET_DOCUMENTOS).remove(paths); } catch { /* best-effort */ }
}

async function subirArchivo(equipoId: string, espacio: number, file: File): Promise<string> {
  const problema = validarArchivoDocumento(file);
  if (problema) throw new Error(problema);
  const path = rutaDocumento(equipoId, espacio, file.name, Date.now().toString(36));
  const { error } = await supabase.storage.from(BUCKET_DOCUMENTOS).upload(path, file, {
    upsert: false, contentType: file.type || 'application/pdf',
  });
  if (error) throw error;
  return path;
}

/** Sube el documento de un espacio libre del equipo. */
export async function subirDocumentoEquipo(input: {
  equipoId: string; espacio: number; nombre: string; file: File; actor: string; actorNombre: string | null;
}): Promise<DocumentoEquipo> {
  const nombre = normalizarNombreDocumento(input.nombre);
  if (!nombre) throw new Error('Pon el nombre del documento.');
  if (!(input.espacio >= 1 && input.espacio <= MAX_DOCUMENTOS_EQUIPO)) {
    throw new Error(`Cada equipo admite hasta ${MAX_DOCUMENTOS_EQUIPO} documentos.`);
  }
  const path = await subirArchivo(input.equipoId, input.espacio, input.file);
  const { data, error } = await supabase.from(TABLE).insert({
    equipo_id: input.equipoId,
    espacio: input.espacio,
    nombre,
    path,
    archivo: input.file.name,
    content_type: input.file.type || null,
    tamano: input.file.size,
    subido_por: input.actor,
    subido_por_nombre: input.actorNombre,
  }).select('*').single();
  if (error) {
    // Sin registro, el archivo subido quedaría huérfano.
    await borrarDelBucket([path]);
    if ((error as { code?: string }).code === '23505') {
      throw new Error('Ese espacio ya tiene un documento: otra persona lo cargó recién. Ya se ve en la lista.');
    }
    throw error;
  }
  await guardarNombreEnCatalogo(nombre);
  return data as DocumentoEquipo;
}

/** Reemplaza el archivo de un documento. El nombre y el espacio no cambian. */
export async function cambiarArchivoDocumento(
  doc: DocumentoEquipo, file: File, actor: string, actorNombre: string | null,
): Promise<void> {
  const path = await subirArchivo(doc.equipo_id, doc.espacio, file);
  const { error } = await supabase.from(TABLE).update({
    path,
    archivo: file.name,
    content_type: file.type || null,
    tamano: file.size,
    subido_por: actor,
    subido_por_nombre: actorNombre,
  }).eq('id', doc.id);
  if (error) { await borrarDelBucket([path]); throw error; }
  // El archivo anterior se borra recién cuando el nuevo ya quedó registrado.
  await borrarDelBucket([doc.path]);
}

/** Cambia el nombre del documento (y lo guarda en el catálogo). */
export async function renombrarDocumento(id: string, nombreCrudo: string): Promise<void> {
  const nombre = normalizarNombreDocumento(nombreCrudo);
  if (!nombre) throw new Error('El nombre no puede quedar vacío.');
  const { error } = await supabase.from(TABLE).update({ nombre }).eq('id', id);
  if (error) throw error;
  await guardarNombreEnCatalogo(nombre);
}

/** Elimina el documento: su registro y su archivo. El espacio queda libre. */
export async function eliminarDocumentoEquipo(doc: DocumentoEquipo): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq('id', doc.id);
  if (error) throw error;
  await borrarDelBucket([doc.path]);
}

/** URL firmada (10 min) para ver o descargar el documento. */
export async function urlDocumentoEquipo(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET_DOCUMENTOS).createSignedUrl(path, 60 * 10);
  if (error) throw error;
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
  await borrarDelBucket(paths);
}
