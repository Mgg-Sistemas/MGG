/* ============================================================
   MGG · Documentación (Supabase)

   · `documentos_empresa` + bucket PRIVADO `documentacion`: los papeles de la
     empresa (RIF, actas, permisos, contratos…). Se ven y descargan con URL
     firmada de 5 minutos.
   · `destinatarios_documentacion`: a quién se le manda documentación. Se
     guardan solos al emitir una nota y se ofrecen la próxima vez.
   · `notas_envio`: la nota de envío con su correlativo (lo pone la base:
     NE-0001, NE-0002…) y su histórico. Se anula, nunca se borra.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { textoDeError } from '@/shared/lib/errores';
import { todasLasFilas } from '@/shared/lib/todasLasFilas';
import { limpiarNombreDoc, nombreArchivoSeguro, nombreDescarga } from '@/modules/maquinaria/documentosEquipo';
import { normalizarNotaEnvio, type DatosNotaEnvio, type ItemNotaEnvio } from './notaEnvio';

export const BUCKET_DOCUMENTACION = 'documentacion';
export const MAX_BYTES_DOCUMENTACION = 20 * 1024 * 1024;
export const ACEPTA_DOCUMENTACION = 'application/pdf,image/*,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt';

/** Categorías sugeridas para ordenar los documentos (se puede escribir otra). */
export const CATEGORIAS_DOCUMENTO = ['LEGAL', 'FISCAL', 'PERMISOS', 'CONTRATOS', 'BANCARIO', 'LABORAL', 'SEGUROS', 'GENERAL'] as const;

export interface DocumentoEmpresa {
  id: string;
  nombre: string;
  categoria: string;
  descripcion: string | null;
  path: string;
  filename: string;
  mime: string | null;
  size_bytes: number | null;
  vence: string | null;
  subido_por: string | null;
  subido_por_nombre: string | null;
  created_at: string;
  updated_at: string;
}

export interface Destinatario {
  id: string;
  razon_social: string;
  rif: string | null;
  direccion: string | null;
  atencion_a: string | null;
  telefono: string | null;
  activo: boolean;
  usos: number;
  ultimo_uso: string | null;
  created_at: string;
}

export type EstadoNotaEnvio = 'emitida' | 'anulada';

export interface NotaEnvio {
  id: string;
  numero: number;
  codigo: string;
  fecha: string;
  destinatario_id: string | null;
  razon_social: string;
  rif: string | null;
  direccion: string | null;
  atencion_a: string | null;
  condicion: string | null;
  items: ItemNotaEnvio[];
  total_cantidad: number;
  entregado_por: string;
  nota: string | null;
  estado: EstadoNotaEnvio;
  anulada_motivo: string | null;
  anulada_por: string | null;
  anulada_en: string | null;
  actor: string | null;
  actor_name: string | null;
  created_at: string;
}

/* ───────── Documentos de la empresa ───────── */

export function validarArchivoDocumentacion(file: { type: string; size: number; name: string }): string | null {
  if (file.size <= 0) return 'El archivo está vacío.';
  if (file.size > MAX_BYTES_DOCUMENTACION) return 'El archivo no puede superar 20 MB.';
  const ok = file.type === 'application/pdf' || file.type.startsWith('image/')
    || /\.(pdf|jpe?g|png|webp|gif|docx?|xlsx?|pptx?|txt)$/i.test(file.name);
  if (!ok) return 'Se aceptan PDF, imágenes y documentos de Word, Excel o PowerPoint.';
  return null;
}

export async function listDocumentosEmpresa(): Promise<DocumentoEmpresa[]> {
  const filas = await todasLasFilas<DocumentoEmpresa>((desde, hasta) =>
    supabase.from('documentos_empresa').select('*').order('categoria').order('nombre').range(desde, hasta));
  return filas;
}

async function subirArchivo(file: File): Promise<string> {
  const nonce = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
  const path = `${new Date().getFullYear()}/${nonce}-${nombreArchivoSeguro(file.name)}`;
  const { error } = await supabase.storage.from(BUCKET_DOCUMENTACION).upload(path, file, {
    contentType: file.type || 'application/octet-stream', upsert: false,
  });
  if (error) throw new Error(textoDeError(error, 'No se pudo subir el archivo.'));
  return path;
}

async function borrarArchivo(path: string): Promise<void> {
  await supabase.storage.from(BUCKET_DOCUMENTACION).remove([path]).catch(() => undefined);
}

export async function guardarDocumentoEmpresa(input: {
  nombre: string; categoria: string; descripcion?: string | null; vence?: string | null;
  file: File | null; actor: string; actorName?: string | null; anterior?: DocumentoEmpresa | null;
}): Promise<DocumentoEmpresa> {
  const nombre = limpiarNombreDoc(input.nombre);
  if (!nombre) throw new Error('Escribí el nombre del documento.');
  const categoria = limpiarNombreDoc(input.categoria) || 'GENERAL';
  const campos = {
    nombre, categoria, descripcion: (input.descripcion ?? '').trim() || null, vence: input.vence || null,
    updated_at: new Date().toISOString(),
  };
  if (input.anterior) {
    let archivo = {};
    let pathNuevo: string | null = null;
    if (input.file) {
      const inv = validarArchivoDocumentacion(input.file);
      if (inv) throw new Error(inv);
      pathNuevo = await subirArchivo(input.file);
      archivo = { path: pathNuevo, filename: input.file.name, mime: input.file.type || null, size_bytes: input.file.size };
    }
    const { data, error } = await supabase.from('documentos_empresa').update({ ...campos, ...archivo }).eq('id', input.anterior.id).select('*').single();
    if (error) { if (pathNuevo) await borrarArchivo(pathNuevo); throw new Error(textoDeError(error, 'No se pudo guardar el documento.')); }
    if (pathNuevo) await borrarArchivo(input.anterior.path);
    return data as DocumentoEmpresa;
  }
  if (!input.file) throw new Error('Elegí el archivo del documento.');
  const inv = validarArchivoDocumentacion(input.file);
  if (inv) throw new Error(inv);
  const path = await subirArchivo(input.file);
  const { data, error } = await supabase.from('documentos_empresa')
    .insert({ ...campos, path, filename: input.file.name, mime: input.file.type || null, size_bytes: input.file.size, subido_por: input.actor, subido_por_nombre: input.actorName ?? null })
    .select('*').single();
  if (error) { await borrarArchivo(path); throw new Error(textoDeError(error, 'No se pudo guardar el documento.')); }
  return data as DocumentoEmpresa;
}

export async function eliminarDocumentoEmpresa(doc: DocumentoEmpresa): Promise<void> {
  const { error } = await supabase.from('documentos_empresa').delete().eq('id', doc.id);
  if (error) throw new Error(textoDeError(error, 'No se pudo eliminar el documento.'));
  await borrarArchivo(doc.path);
}

/** URL firmada (5 min) para ver el documento. */
export async function urlVerDocumentoEmpresa(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET_DOCUMENTACION).createSignedUrl(path, 300);
  if (error || !data) throw new Error(textoDeError(error, 'No se pudo abrir el documento.'));
  return data.signedUrl;
}

/** URL firmada (5 min) que descarga el archivo con el nombre del documento. */
export async function urlDescargaDocumentoEmpresa(doc: DocumentoEmpresa): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET_DOCUMENTACION)
    .createSignedUrl(doc.path, 300, { download: nombreDescarga(doc.nombre, doc.filename) });
  if (error || !data) throw new Error(textoDeError(error, 'No se pudo descargar el documento.'));
  return data.signedUrl;
}

/* ───────── Destinatarios ───────── */

export async function listDestinatarios(): Promise<Destinatario[]> {
  const { data, error } = await supabase.from('destinatarios_documentacion').select('*').eq('activo', true)
    .order('usos', { ascending: false }).order('razon_social');
  if (error) throw new Error(textoDeError(error, 'No se pudieron leer los destinatarios.'));
  return (data ?? []) as Destinatario[];
}

/**
 * Recuerda al destinatario de una nota: si ya existía (misma razón social),
 * le actualiza los datos y le suma un uso; si no, lo crea.
 */
async function recordarDestinatario(d: { razon_social: string; rif: string | null; direccion: string | null; atencion_a: string | null }, actor: string): Promise<string | null> {
  const { data: ex } = await supabase.from('destinatarios_documentacion').select('id, usos')
    .ilike('razon_social', d.razon_social).limit(1).maybeSingle();
  const ahora = new Date().toISOString();
  if (ex) {
    const { error } = await supabase.from('destinatarios_documentacion')
      .update({ rif: d.rif, direccion: d.direccion, atencion_a: d.atencion_a, usos: (Number(ex.usos) || 0) + 1, ultimo_uso: ahora, activo: true, updated_at: ahora })
      .eq('id', ex.id);
    if (error) throw new Error(textoDeError(error, 'No se pudo actualizar el destinatario.'));
    return ex.id as string;
  }
  const { data, error } = await supabase.from('destinatarios_documentacion')
    .insert({ razon_social: d.razon_social, rif: d.rif, direccion: d.direccion, atencion_a: d.atencion_a, usos: 1, ultimo_uso: ahora, creado_por: actor })
    .select('id').single();
  if (error) throw new Error(textoDeError(error, 'No se pudo guardar el destinatario.'));
  return (data?.id as string) ?? null;
}

export async function editarDestinatario(id: string, d: Partial<Pick<Destinatario, 'razon_social' | 'rif' | 'direccion' | 'atencion_a' | 'telefono' | 'activo'>>): Promise<void> {
  const { error } = await supabase.from('destinatarios_documentacion').update({ ...d, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error(textoDeError(error, 'No se pudo guardar el destinatario.'));
}

/* ───────── Notas de envío ───────── */

export async function listNotasEnvio(): Promise<NotaEnvio[]> {
  return todasLasFilas<NotaEnvio>((desde, hasta) =>
    supabase.from('notas_envio').select('*').order('numero', { ascending: false }).range(desde, hasta));
}

export async function getNotaEnvio(id: string): Promise<NotaEnvio> {
  const { data, error } = await supabase.from('notas_envio').select('*').eq('id', id).single();
  if (error) throw new Error(textoDeError(error, 'No se encontró la nota de envío.'));
  return data as NotaEnvio;
}

/** Próximo correlativo que tocaría (solo para mostrar; el definitivo lo pone la base al guardar). */
export async function proximoNumeroNota(): Promise<number> {
  const { data } = await supabase.from('notas_envio').select('numero').order('numero', { ascending: false }).limit(1).maybeSingle();
  return (Number(data?.numero) || 0) + 1;
}

/**
 * Emite la nota: la base le asigna el correlativo (secuencia + trigger) y el
 * destinatario queda guardado para la próxima vez.
 */
export async function crearNotaEnvio(d: DatosNotaEnvio, actor: string, actorName: string | null): Promise<NotaEnvio> {
  const n = normalizarNotaEnvio(d);
  const destinatarioId = await recordarDestinatario(n, actor).catch(() => null);
  const { data, error } = await supabase.from('notas_envio')
    .insert({ ...n, destinatario_id: destinatarioId, actor, actor_name: actorName })
    .select('*').single();
  if (error) throw new Error(textoDeError(error, 'No se pudo emitir la nota de envío.'));
  return data as NotaEnvio;
}

/** Anula una nota (queda en el histórico con su motivo; el correlativo no se reutiliza). */
export async function anularNotaEnvio(id: string, motivo: string, actor: string): Promise<void> {
  const m = motivo.trim();
  if (m.length < 3) throw new Error('Indicá el motivo de la anulación.');
  const { error } = await supabase.from('notas_envio')
    .update({ estado: 'anulada', anulada_motivo: m, anulada_por: actor, anulada_en: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id).eq('estado', 'emitida');
  if (error) throw new Error(textoDeError(error, 'No se pudo anular la nota.'));
}
