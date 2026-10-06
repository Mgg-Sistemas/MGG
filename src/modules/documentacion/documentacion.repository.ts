/* ============================================================
   MGG · Documentación (Supabase)

   · `documentos_empresa` + bucket PRIVADO `documentacion`: los papeles de la
     empresa (RIF, actas, permisos, contratos…). Se ven y descargan con URL
     firmada de 10 minutos.
   · `destinatarios_documentacion`: a quién se le manda documentación. Se
     guardan solos al emitir una nota y se ofrecen la próxima vez.
   · `notas_envio`: la nota de envío con su correlativo (lo pone la base:
     NE-0001, NE-0002…) y su histórico. Se edita mientras está enviada, se
     marca «recibida conforme» (con la copia firmada escaneada, opcional) o
     se anula. Nunca se borra: el correlativo queda completo.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { textoDeError } from '@/shared/lib/errores';
import { todasLasFilas } from '@/shared/lib/todasLasFilas';
import { limpiarNombreDoc, nombreArchivoSeguro, nombreDescarga } from '@/modules/maquinaria/documentosEquipo';
import { errorNotaEnvio, normalizarNotaEnvio, type DatosNotaEnvio, type ItemNotaEnvio } from './notaEnvio';

export const BUCKET_DOCUMENTACION = 'documentacion';
export const MAX_BYTES_DOCUMENTACION = 20 * 1024 * 1024;
export const ACEPTA_DOCUMENTACION = 'application/pdf,image/*,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt';

/** Categorías sugeridas para ordenar los documentos (se puede escribir otra). */
export const CATEGORIAS_DOCUMENTO = ['Legal', 'Fiscal / SENIAT', 'Permisos y licencias', 'Contratos', 'Seguros', 'Bancos', 'Laboral', 'General'];

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
  total_etiqueta: string;
  total_cantidad: number;
  entregado_por: string;
  nota: string | null;
  estado: 'emitida' | 'anulada';
  recibido_por: string | null;
  recibido_en: string | null;
  recibido_path: string | null;
  recibido_nombre: string | null;
  anulada_motivo: string | null;
  anulada_por: string | null;
  anulada_en: string | null;
  actor: string | null;
  actor_name: string | null;
  created_at: string;
}

export type Actor = { email: string; nombre: string | null };

/* ───────── Archivos ───────── */

export function validarArchivoDocumentacion(file: { type: string; size: number; name: string }): string | null {
  if (file.size <= 0) return 'El archivo está vacío.';
  if (file.size > MAX_BYTES_DOCUMENTACION) return 'El archivo no puede superar 20 MB.';
  const ok = file.type === 'application/pdf' || file.type.startsWith('image/')
    || /\.(pdf|jpe?g|png|webp|gif|docx?|xlsx?|pptx?|txt)$/i.test(file.name);
  if (!ok) return 'Se aceptan PDF, imágenes y documentos de Word, Excel o PowerPoint.';
  return null;
}

async function subirArchivo(carpeta: string, file: File): Promise<string> {
  const nonce = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
  const path = `${carpeta}/${nonce}-${nombreArchivoSeguro(file.name)}`;
  const { error } = await supabase.storage.from(BUCKET_DOCUMENTACION).upload(path, file, {
    contentType: file.type || 'application/octet-stream', upsert: false,
  });
  if (error) throw new Error(textoDeError(error, 'No se pudo subir el archivo.'));
  return path;
}

async function borrarArchivo(path: string): Promise<void> {
  await supabase.storage.from(BUCKET_DOCUMENTACION).remove([path]).catch(() => undefined);
}

/** URL firmada (10 min) para ver un archivo del bucket. */
export async function urlArchivoDocumentacion(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET_DOCUMENTACION).createSignedUrl(path, 600);
  if (error || !data) throw new Error(textoDeError(error, 'No se pudo abrir el archivo.'));
  return data.signedUrl;
}

/** URL firmada (10 min) que descarga el archivo con el nombre del documento. */
export async function urlDescargaDocumentoEmpresa(doc: DocumentoEmpresa): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET_DOCUMENTACION)
    .createSignedUrl(doc.path, 600, { download: nombreDescarga(doc.nombre, doc.filename) });
  if (error || !data) throw new Error(textoDeError(error, 'No se pudo descargar el documento.'));
  return data.signedUrl;
}

/* ───────── Documentos de la empresa ───────── */

export async function listDocumentosEmpresa(): Promise<DocumentoEmpresa[]> {
  return todasLasFilas<DocumentoEmpresa>((desde, hasta) =>
    supabase.from('documentos_empresa').select('*').order('categoria').order('nombre').range(desde, hasta));
}

export async function guardarDocumentoEmpresa(input: {
  nombre: string; categoria: string; descripcion?: string | null; vence?: string | null;
  file: File | null; actor: Actor; anterior?: DocumentoEmpresa | null;
}): Promise<DocumentoEmpresa> {
  const nombre = limpiarNombreDoc(input.nombre);
  if (!nombre) throw new Error('Escribí el nombre del documento.');
  const categoria = (input.categoria ?? '').replace(/\s+/g, ' ').trim() || 'General';
  // Una categoría escrita a mano queda en el catálogo para la próxima vez.
  await asegurarCategoriaDocumento(categoria, input.actor.email);
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
      pathNuevo = await subirArchivo('documentos', input.file);
      archivo = { path: pathNuevo, filename: input.file.name, mime: input.file.type || null, size_bytes: input.file.size };
    }
    const { data, error } = await supabase.from('documentos_empresa').update({ ...campos, ...archivo }).eq('id', input.anterior.id).select('*').single();
    if (error) { if (pathNuevo) await borrarArchivo(pathNuevo); throw new Error(textoDeError(error, 'No se pudo guardar el documento.')); }
    if (pathNuevo) await borrarArchivo(input.anterior.path);
    return data as DocumentoEmpresa;
  }
  if (!input.file) throw new Error('Adjuntá el archivo del documento.');
  const inv = validarArchivoDocumentacion(input.file);
  if (inv) throw new Error(inv);
  const path = await subirArchivo('documentos', input.file);
  const { data, error } = await supabase.from('documentos_empresa')
    .insert({ ...campos, path, filename: input.file.name, mime: input.file.type || null, size_bytes: input.file.size, subido_por: input.actor.email, subido_por_nombre: input.actor.nombre })
    .select('*').single();
  if (error) { await borrarArchivo(path); throw new Error(textoDeError(error, 'No se pudo guardar el documento.')); }
  return data as DocumentoEmpresa;
}

/** Borra el archivo (desde la app: SQL no puede tocar storage) y luego el registro. */
export async function eliminarDocumentoEmpresa(doc: DocumentoEmpresa): Promise<void> {
  const { error } = await supabase.from('documentos_empresa').delete().eq('id', doc.id);
  if (error) throw new Error(textoDeError(error, 'No se pudo eliminar el documento.'));
  await borrarArchivo(doc.path);
}

/* ───────── Categorías (catálogo) ─────────
   Antes la categoría solo vivía escrita en cada documento: una categoría nueva
   sin documentos no existía. Ahora es un catálogo propio: se agrega, se renombra
   (y los documentos que la usan se renombran con ella) y se borra. */

export interface CategoriaDocumento {
  id: string;
  nombre: string;
  created_at: string;
}

export async function listCategoriasDocumento(): Promise<CategoriaDocumento[]> {
  const { data, error } = await supabase.from('categorias_documentacion').select('*').order('nombre');
  if (error) throw new Error(textoDeError(error, 'No se pudieron leer las categorías.'));
  return (data ?? []) as CategoriaDocumento[];
}

export async function crearCategoriaDocumento(nombre: string, actor: string): Promise<CategoriaDocumento> {
  const n = nombre.replace(/\s+/g, ' ').trim();
  if (!n) throw new Error('Escribí el nombre de la categoría.');
  const { data, error } = await supabase.from('categorias_documentacion').insert({ nombre: n, creado_por: actor }).select('*').single();
  if (error) {
    if ((error as { code?: string }).code === '23505') throw new Error(`La categoría «${n}» ya existe.`);
    throw new Error(textoDeError(error, 'No se pudo crear la categoría.'));
  }
  return data as CategoriaDocumento;
}

/** Asegura que la categoría exista en el catálogo (al guardar un documento con una nueva). */
export async function asegurarCategoriaDocumento(nombre: string, actor: string): Promise<void> {
  const n = nombre.replace(/\s+/g, ' ').trim();
  if (!n) return;
  const { data } = await supabase.from('categorias_documentacion').select('id').ilike('nombre', n).limit(1).maybeSingle();
  if (data) return;
  await crearCategoriaDocumento(n, actor).catch(() => undefined);
}

/** Renombra la categoría y arrastra a los documentos que la usaban. */
export async function renombrarCategoriaDocumento(c: CategoriaDocumento, nuevo: string): Promise<void> {
  const n = nuevo.replace(/\s+/g, ' ').trim();
  if (!n) throw new Error('Escribí el nombre de la categoría.');
  if (n === c.nombre) return;
  const { error } = await supabase.from('categorias_documentacion').update({ nombre: n, updated_at: new Date().toISOString() }).eq('id', c.id);
  if (error) {
    if ((error as { code?: string }).code === '23505') throw new Error(`La categoría «${n}» ya existe.`);
    throw new Error(textoDeError(error, 'No se pudo renombrar la categoría.'));
  }
  const { error: e2 } = await supabase.from('documentos_empresa').update({ categoria: n }).eq('categoria', c.nombre);
  if (e2) throw new Error(textoDeError(e2, 'La categoría se renombró, pero no se pudieron actualizar sus documentos.'));
}

/** Borra la categoría. Los documentos que la usaban pasan a «General». */
export async function eliminarCategoriaDocumento(c: CategoriaDocumento): Promise<number> {
  const { data: usados } = await supabase.from('documentos_empresa').select('id').eq('categoria', c.nombre);
  const cuantos = (usados ?? []).length;
  if (cuantos) {
    const { error: e1 } = await supabase.from('documentos_empresa').update({ categoria: 'General' }).eq('categoria', c.nombre);
    if (e1) throw new Error(textoDeError(e1, 'No se pudieron mover los documentos de la categoría.'));
  }
  const { error } = await supabase.from('categorias_documentacion').delete().eq('id', c.id);
  if (error) throw new Error(textoDeError(error, 'No se pudo eliminar la categoría.'));
  return cuantos;
}

/* ───────── Destinatarios ───────── */

export async function listDestinatarios(): Promise<Destinatario[]> {
  const { data, error } = await supabase.from('destinatarios_documentacion').select('*').eq('activo', true)
    .order('usos', { ascending: false }).order('razon_social');
  if (error) throw new Error(textoDeError(error, 'No se pudieron leer los destinatarios.'));
  return (data ?? []) as Destinatario[];
}

/** Recuerda al destinatario: si ya existía (misma razón social), actualiza y suma un uso; si no, lo crea. */
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

/* ───────── Notas de envío ───────── */

export async function listNotasEnvio(): Promise<NotaEnvio[]> {
  return todasLasFilas<NotaEnvio>((desde, hasta) =>
    supabase.from('notas_envio').select('*').order('numero', { ascending: false }).range(desde, hasta));
}

function filaNota(d: DatosNotaEnvio) {
  const err = errorNotaEnvio(d);
  if (err) throw new Error(err);
  return normalizarNotaEnvio(d);
}

/** Crea la nota; el N° lo pone la base y vuelve en la fila. El destinatario queda guardado. */
export async function crearNotaEnvio(d: DatosNotaEnvio, actor: Actor): Promise<NotaEnvio> {
  const n = filaNota(d);
  const destinatarioId = await recordarDestinatario(n, actor.email).catch(() => null);
  const { data, error } = await supabase.from('notas_envio')
    .insert({ ...n, destinatario_id: destinatarioId, actor: actor.email, actor_name: actor.nombre })
    .select('*').single();
  if (error) throw new Error(textoDeError(error, 'No se pudo emitir la nota de envío.'));
  return data as NotaEnvio;
}

/** Corrige una nota mientras está enviada (no cambia su N°). */
export async function actualizarNotaEnvio(id: string, d: DatosNotaEnvio): Promise<NotaEnvio> {
  const { data, error } = await supabase.from('notas_envio')
    .update({ ...filaNota(d), updated_at: new Date().toISOString() })
    .eq('id', id).eq('estado', 'emitida').is('recibido_en', null)
    .select('*').maybeSingle();
  if (error) throw new Error(textoDeError(error, 'No se pudo guardar la nota.'));
  if (!data) throw new Error('La nota ya no está en estado «Enviada»: no se puede editar.');
  return data as NotaEnvio;
}

/** Marca la nota como recibida conforme; opcionalmente adjunta la copia firmada escaneada. */
export async function marcarRecibida(n: NotaEnvio, recibidoPor: string, copiaFirmada: File | null): Promise<NotaEnvio> {
  if (n.estado === 'anulada') throw new Error('La nota está anulada.');
  let recibido_path = n.recibido_path; let recibido_nombre = n.recibido_nombre;
  if (copiaFirmada) {
    const inv = validarArchivoDocumentacion(copiaFirmada);
    if (inv) throw new Error(inv);
    recibido_path = await subirArchivo(`envios/${n.id}`, copiaFirmada); recibido_nombre = copiaFirmada.name;
  }
  const { data, error } = await supabase.from('notas_envio')
    .update({ recibido_por: recibidoPor.trim() || null, recibido_en: n.recibido_en ?? new Date().toISOString(), recibido_path, recibido_nombre, updated_at: new Date().toISOString() })
    .eq('id', n.id).eq('estado', 'emitida')
    .select('*').maybeSingle();
  if (error) throw new Error(textoDeError(error, 'No se pudo marcar la nota como recibida.'));
  if (!data) throw new Error('La nota está anulada.');
  if (copiaFirmada && n.recibido_path && n.recibido_path !== recibido_path) await borrarArchivo(n.recibido_path);
  return data as NotaEnvio;
}

/** Anula la nota: queda en el histórico con su N° (el correlativo no se reutiliza). */
export async function anularNotaEnvio(n: NotaEnvio, motivo: string, actorEmail: string): Promise<void> {
  const m = motivo.trim();
  if (!m) throw new Error('Escribí el motivo de la anulación.');
  const { error } = await supabase.from('notas_envio')
    .update({ estado: 'anulada', anulada_motivo: m, anulada_por: actorEmail, anulada_en: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', n.id);
  if (error) throw new Error(textoDeError(error, 'No se pudo anular la nota.'));
}
