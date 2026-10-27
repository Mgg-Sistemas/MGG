/* ============================================================
   Golden Touch · Control de Maquinaria · Fotos de la orden de servicio
   Tabla `maquinaria_os_fotos` + bucket privado `maquinaria-os-fotos`
   (solo imágenes, hasta 2 MB). Hasta 4 por orden: la base lo exige con
   un trigger que bloquea la orden mientras cuenta (dos teléfonos que
   suben a la vez no pasan de 4).

   Los archivos se borran DESDE LA APP y antes que la fila: Supabase no
   deja borrar storage.objects desde SQL, así que una cascada en la base
   dejaría el archivo huérfano.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { comprimirImagen, cargarImagenDesdeBlob, nombreJpg } from '@/shared/lib/comprimirImagen';
import { errorFotoLista, errorFotoOriginal, OBJETIVO_BYTES_FOTO, rutaFotoOrden } from './osFotos';

export const BUCKET_OS_FOTOS = 'maquinaria-os-fotos';
export const TABLA_OS_FOTOS = 'maquinaria_os_fotos';

export interface FotoOrden {
  id: string;
  orden_id: string;
  path: string;
  nombre: string;
  /** Puesto 1..4 dentro de la orden. */
  orden: number;
  content_type: string | null;
  tamano: number | null;
  subido_por: string | null;
  subido_por_nombre: string | null;
  created_at: string;
}

/**
 * Deja la foto lista para subir: JPG de ~1600 px (el helper del sistema) y, si aun
 * así pasa de 1 MB, una segunda pasada más chica. Lanza el error si no sirve.
 */
export async function prepararFotoOrden(original: File): Promise<File> {
  const antes = errorFotoOriginal(original);
  if (antes) throw new Error(antes);
  let file = await comprimirImagen(original);
  // HEIC u otro formato que comprimirImagen dejó igual por pesar poco: se fuerza a JPG.
  if (file.size > OBJETIVO_BYTES_FOTO || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    file = await reducir(file, 1280, 0.72).catch(() => file);
  }
  const despues = errorFotoLista(file);
  if (despues) throw new Error(despues);
  return file;
}

async function reducir(file: File, lado: number, calidad: number): Promise<File> {
  if (typeof document === 'undefined') return file;
  const img = await cargarImagenDesdeBlob(file);
  const escala = Math.min(1, lado / Math.max(img.width, img.height, 1));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * escala));
  canvas.height = Math.max(1, Math.round(img.height * escala));
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  if ('close' in img && typeof img.close === 'function') img.close();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', calidad));
  if (!blob) return file;
  return new File([blob], nombreJpg(file.name), { type: 'image/jpeg', lastModified: Date.now() });
}

/** Fotos de una orden, por puesto. */
export async function listFotosOrden(ordenId: string): Promise<FotoOrden[]> {
  if (!ordenId) return [];
  const { data, error } = await supabase.from(TABLA_OS_FOTOS).select('*')
    .eq('orden_id', ordenId).order('orden', { ascending: true });
  if (error) throw error;
  return (data ?? []) as FotoOrden[];
}

/** Cuántas fotos tiene cada orden (para el botón «📷 n» de las listas). */
export async function contarFotosPorOrden(): Promise<Map<string, number>> {
  const { data, error } = await supabase.from(TABLA_OS_FOTOS).select('orden_id');
  if (error) throw error;
  const m = new Map<string, number>();
  for (const r of (data ?? []) as { orden_id: string }[]) m.set(r.orden_id, (m.get(r.orden_id) ?? 0) + 1);
  return m;
}

/**
 * Sube UNA foto ya preparada (ver `prepararFotoOrden`) y la registra. El puesto lo
 * elige la base (el primero libre); si la orden se llenó entretanto, la base lo
 * rechaza y el archivo se borra para no dejarlo huérfano.
 */
export async function subirFotoOrden(ordenId: string, file: File, actor: string | null, actorNombre: string | null): Promise<FotoOrden> {
  const problema = errorFotoLista(file);
  if (problema) throw new Error(problema);
  const path = rutaFotoOrden(ordenId, `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, file.name);
  const { error: ue } = await supabase.storage.from(BUCKET_OS_FOTOS).upload(path, file, { upsert: false, contentType: file.type });
  if (ue) throw ue;
  const { data, error } = await supabase.from(TABLA_OS_FOTOS).insert({
    orden_id: ordenId,
    path,
    nombre: file.name || 'foto.jpg',
    content_type: file.type || null,
    tamano: file.size,
    subido_por: actor,
    subido_por_nombre: actorNombre,
  }).select('*').single();
  if (error) {
    try { await supabase.storage.from(BUCKET_OS_FOTOS).remove([path]); } catch { /* best-effort */ }
    throw error;
  }
  return data as FotoOrden;
}

/** Sube varias (ya preparadas) una tras otra; devuelve cuántas entraron y qué falló. */
export async function subirFotosOrden(ordenId: string, files: File[], actor: string | null, actorNombre: string | null): Promise<{ subidas: number; fallos: string[] }> {
  let subidas = 0;
  const fallos: string[] = [];
  for (const f of files) {
    try { await subirFotoOrden(ordenId, f, actor, actorNombre); subidas++; }
    catch (e) { fallos.push(`${f.name}: ${e instanceof Error ? e.message : (e as { message?: string })?.message ?? 'error'}`); }
  }
  return { subidas, fallos };
}

/** Quita la foto: primero el archivo (desde la app) y después la fila. */
export async function eliminarFotoOrden(foto: Pick<FotoOrden, 'id' | 'path'>): Promise<void> {
  const { error: se } = await supabase.storage.from(BUCKET_OS_FOTOS).remove([foto.path]);
  if (se) throw se;
  const { error } = await supabase.from(TABLA_OS_FOTOS).delete().eq('id', foto.id);
  if (error) throw error;
}

/** URLs firmadas (1 h) de varias fotos: path → url. */
export async function urlsFotos(paths: string[]): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  if (!paths.length) return m;
  const { data, error } = await supabase.storage.from(BUCKET_OS_FOTOS).createSignedUrls(paths, 3600);
  if (error) throw error;
  (data ?? []).forEach((r, i) => { if (r.signedUrl) m.set(paths[i], r.signedUrl); });
  return m;
}

/** Fotos de la orden con su URL firmada, en orden (para el PDF). */
export async function fotosOrdenConUrl(ordenId: string): Promise<{ nombre: string; url: string }[]> {
  const fotos = await listFotosOrden(ordenId);
  const urls = await urlsFotos(fotos.map((f) => f.path));
  return fotos.flatMap((f) => (urls.get(f.path) ? [{ nombre: f.nombre, url: urls.get(f.path) as string }] : []));
}

/** Rutas de las fotos de todas las órdenes de un equipo (antes de eliminar el equipo). */
export async function pathsFotosDeEquipo(equipoId: string): Promise<string[]> {
  const { data: ords, error: oe } = await supabase.from('maquinaria_ordenes_servicio').select('id').eq('equipo_id', equipoId);
  if (oe) throw oe;
  const ids = ((ords ?? []) as { id: string }[]).map((o) => o.id);
  if (!ids.length) return [];
  const { data, error } = await supabase.from(TABLA_OS_FOTOS).select('path').in('orden_id', ids);
  if (error) throw error;
  return ((data ?? []) as { path: string }[]).map((r) => r.path);
}

/** Borra archivos del bucket de fotos (las filas se van por la FK en cascada). */
export async function borrarArchivosFotosOrden(paths: string[]): Promise<void> {
  if (!paths.length) return;
  try { await supabase.storage.from(BUCKET_OS_FOTOS).remove(paths); } catch { /* best-effort */ }
}
