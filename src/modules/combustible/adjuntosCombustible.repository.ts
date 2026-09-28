/* ============================================================
   MGG · Combustible · Fotos de un movimiento de tanque

   El que surte está parado al lado del tanque con el teléfono: le saca
   foto al contador, al equipo y al vale, y esas fotos son la prueba de
   lo que cargó. Van a su propio depósito PRIVADO (`combustible-adjuntos`)
   con su tabla (`combustible_adjuntos`), y se abren con un enlace
   firmado que caduca a los 10 minutos.

   Las fotos se suben DESPUÉS de guardar el movimiento: la carpeta lleva
   el id del movimiento, y ese id no existe hasta que la fila está
   insertada.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import type { AdjuntoCombustible } from '@/shared/lib/types';

const BUCKET = 'combustible-adjuntos';
const TABLA = 'combustible_adjuntos';

/** Qué cosa del módulo lleva el adjunto. Hoy solo el movimiento de tanque. */
export const MODULO_ADJUNTO_TANQUE = 'tanque_mov';

/** Cuánto vive el enlace de descarga: lo que tarda alguien en mirarlo. */
const MINUTOS_ENLACE = 10;

/** Tope por movimiento. El que surte saca tres o cuatro fotos, no un álbum. */
export const MAX_FOTOS_MOVIMIENTO = 4;

/** Tope por archivo: una foto de teléfono ronda los 3 MB. */
export const MAX_BYTES_FOTO = 15 * 1024 * 1024;

/** Nombre sin acentos ni espacios, que es lo que aguanta una ruta de Storage. */
function nombreSeguro(nombre: string): string {
  return (nombre || 'foto')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .slice(-80);
}

/** Qué le pasa a un archivo que no se puede subir. Null si está bien. */
export function errorFoto(f: File): string | null {
  if (!f.size) return `«${f.name}» está vacío.`;
  if (f.size > MAX_BYTES_FOTO) return `«${f.name}» pesa más de 15 MB.`;
  const tipo = (f.type || '').toLowerCase();
  const ext = (f.name.split('.').pop() ?? '').toLowerCase();
  const esImagen = tipo.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'].includes(ext);
  const esPdf = tipo === 'application/pdf' || ext === 'pdf';
  // Algunas cámaras de teléfono mandan el archivo con `type` vacío: por eso
  // también se mira la extensión antes de rechazarlo.
  if (!esImagen && !esPdf) return `«${f.name}» no es una foto ni un PDF.`;
  return null;
}

/** ¿Se puede mostrar como imagen? Si no, se dibuja como documento. */
export function esImagen(contentType?: string | null, nombre?: string | null): boolean {
  if ((contentType ?? '').toLowerCase().startsWith('image/')) return true;
  const ext = (nombre ?? '').split('.').pop()?.toLowerCase() ?? '';
  return ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'gif'].includes(ext);
}

/** Las fotos de UN movimiento. */
export async function listarFotos(refId: string): Promise<AdjuntoCombustible[]> {
  const { data, error } = await supabase.from(TABLA).select('*')
    .eq('modulo', MODULO_ADJUNTO_TANQUE).eq('ref_id', refId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as AdjuntoCombustible[];
}

/** Las fotos de VARIOS movimientos de una sola consulta (para el reporte). */
export async function listarFotosDe(refIds: string[]): Promise<AdjuntoCombustible[]> {
  if (!refIds.length) return [];
  const { data, error } = await supabase.from(TABLA).select('*')
    .eq('modulo', MODULO_ADJUNTO_TANQUE).in('ref_id', refIds)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as AdjuntoCombustible[];
}

/** Cuántas fotos tiene cada movimiento, para el contador de la lista. */
export async function contarFotos(refIds: string[]): Promise<Map<string, number>> {
  const acc = new Map<string, number>();
  for (const a of await listarFotosDe(refIds)) {
    acc.set(a.ref_id, (acc.get(a.ref_id) ?? 0) + 1);
  }
  return acc;
}

/** Enlace firmado de UNA foto. */
export async function urlFoto(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * MINUTOS_ENLACE);
  if (error) throw error;
  return data.signedUrl;
}

/** Enlaces firmados de varias, para pintar las miniaturas del reporte. */
export async function urlsFotos(paths: string[]): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  if (!paths.length) return mapa;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 60 * MINUTOS_ENLACE);
  if (error) throw error;
  for (const d of data ?? []) {
    if (d.path && d.signedUrl) mapa.set(d.path, d.signedUrl);
  }
  return mapa;
}

/** Lo que salió de subir una tanda: lo que entró y lo que no. */
export interface ResultadoSubida {
  subidas: AdjuntoCombustible[];
  fallos: string[];
}

/**
 * Sube las fotos de un movimiento.
 *
 * Va de a una y sin cortar en el primer error: con mala señal es normal que una
 * se caiga, y perder las otras tres por eso sería peor. Lo que falló se informa
 * por su nombre para poder reintentarlo.
 */
export async function subirFotos(refId: string, files: File[], actor: string): Promise<ResultadoSubida> {
  const subidas: AdjuntoCombustible[] = [];
  const fallos: string[] = [];

  const yaHay = (await listarFotos(refId).catch(() => [])).length;
  const cupo = Math.max(0, MAX_FOTOS_MOVIMIENTO - yaHay);

  for (const f of files.slice(0, cupo)) {
    const malo = errorFoto(f);
    if (malo) { fallos.push(malo); continue; }
    const rand = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.round(Math.random() * 1e9)}`).slice(0, 8);
    const path = `${refId}/${rand}-${nombreSeguro(f.name)}`;
    try {
      const { error: sErr } = await supabase.storage.from(BUCKET)
        .upload(path, f, { upsert: false, contentType: f.type || 'application/octet-stream' });
      if (sErr) throw sErr;
      const { data, error } = await supabase.from(TABLA).insert({
        modulo: MODULO_ADJUNTO_TANQUE, ref_id: refId, path,
        nombre: f.name, content_type: f.type || null, bytes: f.size, creado_por: actor,
      }).select('*').single();
      if (error) {
        // El archivo quedó arriba pero sin fila: se limpia para no dejar basura.
        try { await supabase.storage.from(BUCKET).remove([path]); } catch { /* ya es basura igual */ }
        throw error;
      }
      subidas.push(data as AdjuntoCombustible);
    } catch (e) {
      fallos.push(`${f.name}: ${e instanceof Error ? e.message : 'no se pudo subir'}`);
    }
  }

  if (files.length > cupo) {
    fallos.push(`Solo caben ${MAX_FOTOS_MOVIMIENTO} fotos por movimiento: ${files.length - cupo} quedaron fuera.`);
  }
  return { subidas, fallos };
}

/** Borra una foto (del depósito y de la tabla). */
export async function eliminarFoto(a: AdjuntoCombustible): Promise<void> {
  const { error } = await supabase.from(TABLA).delete().eq('id', a.id);
  if (error) throw error;
  // Best-effort: si el archivo no se borra queda huérfano y no molesta a nadie;
  // lo que importa —que deje de aparecer— ya está hecho.
  try { await supabase.storage.from(BUCKET).remove([a.path]); } catch { /* el Storage no bloquea */ }
}

/** Borra todas las fotos de un movimiento (al eliminarlo). */
export async function eliminarFotosDe(refId: string): Promise<void> {
  const fotos = await listarFotos(refId).catch(() => [] as AdjuntoCombustible[]);
  if (!fotos.length) return;
  await supabase.from(TABLA).delete().eq('modulo', MODULO_ADJUNTO_TANQUE).eq('ref_id', refId);
  try { await supabase.storage.from(BUCKET).remove(fotos.map((f) => f.path)); } catch { /* el Storage no bloquea */ }
}
