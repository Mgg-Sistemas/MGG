/* ============================================================
   MGG · Choferes · Guías (tabla choferes_guias + bucket privado choferes-guias)
   Los PDF no quedan públicos: se ven y se descargan con un enlace firmado.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { textoDeError } from '@/shared/lib/errores';
import { todasLasFilas } from '@/shared/lib/todasLasFilas';
import { nombreArchivoSeguro } from '@/modules/maquinaria/documentosEquipo';
import { nombreDescargaGuia, validarGuia, validarPdfGuia, type DatosGuia, type Guia } from './guias';

export const BUCKET_GUIAS = 'choferes-guias';
const TABLA = 'choferes_guias';

/** Todas las guías, de la más nueva a la más vieja (por páginas: Supabase corta en 1.000). */
export async function listGuias(): Promise<Guia[]> {
  return todasLasFilas<Guia>((d, h) =>
    supabase.from(TABLA).select('*').order('fecha', { ascending: false }).order('created_at', { ascending: false }).order('id').range(d, h));
}

async function borrarArchivo(path: string): Promise<void> {
  await supabase.storage.from(BUCKET_GUIAS).remove([path]).catch(() => undefined);
}

/** Sube el PDF y registra la guía. Si el registro falla, el archivo se borra. */
export async function registrarGuia(d: DatosGuia, file: File, actor: string, actorName: string | null): Promise<Guia> {
  const err = validarGuia(d) ?? validarPdfGuia(file);
  if (err) throw new Error(err);
  const nonce = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
  const path = `${d.fecha.slice(0, 7)}/${nonce}-${nombreArchivoSeguro(file.name)}`;
  const { error: upErr } = await supabase.storage.from(BUCKET_GUIAS).upload(path, file, { contentType: 'application/pdf', upsert: false });
  if (upErr) throw new Error(textoDeError(upErr, 'No se pudo subir el PDF.'));
  const { data, error } = await supabase.from(TABLA).insert({
    fecha: d.fecha, numero: d.numero.trim() || null, descripcion: d.descripcion.trim(),
    conductor_id: d.conductorId || null, path, filename: file.name, mime: 'application/pdf', size_bytes: file.size,
    nota: d.nota.trim() || null, actor, actor_name: actorName,
  }).select('*').single();
  if (error) { await borrarArchivo(path); throw new Error(textoDeError(error, 'No se pudo guardar la guía.')); }
  return data as Guia;
}

/** Corrige los datos de una guía (el PDF queda igual). */
export async function actualizarGuia(id: string, d: DatosGuia): Promise<void> {
  const err = validarGuia(d);
  if (err) throw new Error(err);
  const { data, error } = await supabase.from(TABLA).update({
    fecha: d.fecha, numero: d.numero.trim() || null, descripcion: d.descripcion.trim(),
    conductor_id: d.conductorId || null, nota: d.nota.trim() || null,
  }).eq('id', id).select('id');
  if (error) throw new Error(textoDeError(error, 'No se pudo guardar la guía.'));
  if (!data?.length) throw new Error('No se pudo guardar: sin permiso o la guía ya no existe.');
}

/** Elimina la guía y su PDF. */
export async function eliminarGuia(g: Guia): Promise<void> {
  const { data, error } = await supabase.from(TABLA).delete().eq('id', g.id).select('id');
  if (error) throw new Error(textoDeError(error, 'No se pudo eliminar la guía.'));
  if (!data?.length) throw new Error('No se pudo eliminar: sin permiso o la guía ya no existía.');
  await borrarArchivo(g.path);
}

/** Enlace firmado (10 min) para la vista previa. */
export async function urlVerGuia(g: Guia): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET_GUIAS).createSignedUrl(g.path, 600);
  if (error || !data) throw new Error(textoDeError(error, 'No se pudo abrir la guía.'));
  return data.signedUrl;
}

/** Enlace firmado (5 min) que descarga el PDF con un nombre legible. */
export async function urlDescargaGuia(g: Guia): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET_GUIAS).createSignedUrl(g.path, 300, { download: nombreDescargaGuia(g) });
  if (error || !data) throw new Error(textoDeError(error, 'No se pudo descargar la guía.'));
  return data.signedUrl;
}
