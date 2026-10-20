/* ============================================================
   MGG · Maquinaria · Fotos del equipo (Supabase) · 16-10-2026

   Tabla `maquinaria_fotos` + bucket privado `equipos-docs` (carpeta fotos/).
   Aparte de los documentos (RCV, placa, serial…): la portada del expediente,
   del catálogo y de la ficha PDF sale SIEMPRE de acá, nunca de un documento.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { textoDeError } from '@/shared/lib/errores';
import { subirConReintento } from '@/shared/lib/storageReintento';
import { BUCKET_DOCS_EQUIPO, type DocumentoEquipo } from './maquinariaDocumentos.repository';
import { prepararFotoOrden } from './osFotos.repository';
import { errorFotoLista } from './osFotos';
import { MAX_FOTOS_EQUIPO, ordenarFotos, ordenesAlHacerPortada, rutaFotoEquipo } from './fotosEquipo';

export const TABLA_FOTOS_EQUIPO = 'maquinaria_fotos';

export interface FotoEquipoFila {
  id: string;
  equipo_id: string;
  path: string;
  filename: string;
  mime: string | null;
  size_bytes: number | null;
  nombre: string | null;
  orden: number;
  /** cubrir = recorta para llenar la portada; completa = se ve entera (16-10-2026). */
  encuadre: EncuadreFoto;
  created_by: string | null;
  created_at: string;
}

export type EncuadreFoto = 'cubrir' | 'completa';

/** Cambia cómo se encuadra una foto en la portada (recortada para llenar, o completa). */
export async function cambiarEncuadreFoto(fotoId: string, encuadre: EncuadreFoto): Promise<void> {
  const { error } = await supabase.from(TABLA_FOTOS_EQUIPO).update({ encuadre }).eq('id', fotoId);
  if (error) throw new Error(textoDeError(error, 'No se pudo cambiar el encuadre de la foto.'));
}

/** Fotos de un equipo (o de todos), portada primero, sin URL. */
export async function listFotosEquipo(equipoId?: string): Promise<FotoEquipoFila[]> {
  let q = supabase.from(TABLA_FOTOS_EQUIPO).select('*').order('orden', { ascending: true }).order('created_at', { ascending: true });
  if (equipoId) q = q.eq('equipo_id', equipoId);
  const { data, error } = await q;
  if (error) throw new Error(textoDeError(error, 'No se pudieron leer las fotos del equipo.'));
  return ordenarFotos((data ?? []) as FotoEquipoFila[]);
}

/** Deja la foto lista (JPG liviano): la misma preparación que las fotos de las órdenes. */
export const prepararFotoEquipo = prepararFotoOrden;

/**
 * Sube UNA foto (ya preparada) al final de la lista del equipo. Si el equipo ya tiene
 * las 8, se rechaza antes de subir. Si la fila no se pudo guardar, el archivo se borra.
 */
export async function subirFotoEquipo(equipoId: string, file: File, actor: string | null): Promise<FotoEquipoFila> {
  const problema = errorFotoLista(file);
  if (problema) throw new Error(problema);
  const actuales = await listFotosEquipo(equipoId);
  if (actuales.length >= MAX_FOTOS_EQUIPO) throw new Error(`El equipo ya tiene las ${MAX_FOTOS_EQUIPO} fotos. Elimina una para agregar otra.`);
  const path = rutaFotoEquipo(equipoId, `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, file.name);
  // Subida con reintento (20-10-2026): el Storage de Supabase tira 520/503 de
  // forma INTERMITENTE y supabase-js no reintenta un POST. Si el fallo es cosa
  // del servidor o de la red se repite hasta 3 veces; si es cosa nuestra
  // (permisos, política, peso) se lanza el error original con su explicación.
  try {
    await subirConReintento(async () => {
      const { error: ue } = await supabase.storage.from(BUCKET_DOCS_EQUIPO).upload(path, file, { upsert: false, contentType: file.type });
      if (ue) throw ue;
    });
  } catch (e) {
    throw new Error(textoDeError(e, 'No se pudo subir la foto.'));
  }
  const orden = actuales.length ? Math.max(...actuales.map((f) => f.orden)) + 1 : 0;
  const { data, error } = await supabase.from(TABLA_FOTOS_EQUIPO).insert({
    equipo_id: equipoId, path, filename: file.name || 'foto.jpg', mime: file.type || null, size_bytes: file.size, orden, created_by: actor,
  }).select('*').single();
  if (error) {
    await supabase.storage.from(BUCKET_DOCS_EQUIPO).remove([path]).catch(() => undefined);
    throw new Error(textoDeError(error, 'No se pudo guardar la foto.'));
  }
  return data as FotoEquipoFila;
}

/** Varias, una tras otra (cada una se prepara y se sube sola); dice cuántas entraron y qué falló. */
export async function subirFotosEquipo(equipoId: string, files: File[], actor: string | null): Promise<{ subidas: number; fallos: string[] }> {
  let subidas = 0;
  const fallos: string[] = [];
  for (const original of files) {
    try {
      const f = await prepararFotoEquipo(original);
      await subirFotoEquipo(equipoId, f, actor);
      subidas++;
    } catch (e) {
      fallos.push(`${original.name}: ${e instanceof Error ? e.message : 'error'}`);
    }
  }
  return { subidas, fallos };
}

/** Elimina la foto: primero el archivo y después la fila. */
export async function eliminarFotoEquipo(foto: Pick<FotoEquipoFila, 'id' | 'path'>): Promise<void> {
  const { error: se } = await supabase.storage.from(BUCKET_DOCS_EQUIPO).remove([foto.path]);
  if (se) throw new Error(textoDeError(se, 'No se pudo borrar el archivo de la foto.'));
  const { error } = await supabase.from(TABLA_FOTOS_EQUIPO).delete().eq('id', foto.id);
  if (error) throw new Error(textoDeError(error, 'No se pudo eliminar la foto.'));
}

/** Vuelve portada una foto (orden 0) y corre las demás. */
export async function hacerPortadaFoto(equipoId: string, fotoId: string): Promise<void> {
  const fotos = await listFotosEquipo(equipoId);
  for (const n of ordenesAlHacerPortada(fotos, fotoId)) {
    const { error } = await supabase.from(TABLA_FOTOS_EQUIPO).update({ orden: n.orden }).eq('id', n.id);
    if (error) throw new Error(textoDeError(error, 'No se pudo cambiar la portada.'));
  }
}

/**
 * Una imagen que se subió como DOCUMENTO (p. ej. «FOTO DEL EQUIPO» en un espacio)
 * pasa a ser foto del equipo: mismo archivo, cambia de tabla y libera el espacio.
 */
export async function documentoAFotoEquipo(doc: DocumentoEquipo, actor: string | null): Promise<void> {
  if (!(doc.mime ?? '').startsWith('image/')) throw new Error('Solo una imagen puede pasar a foto del equipo.');
  const actuales = await listFotosEquipo(doc.equipo_id);
  if (actuales.length >= MAX_FOTOS_EQUIPO) throw new Error(`El equipo ya tiene las ${MAX_FOTOS_EQUIPO} fotos. Elimina una antes.`);
  const orden = actuales.length ? Math.max(...actuales.map((f) => f.orden)) + 1 : 0;
  const { error } = await supabase.from(TABLA_FOTOS_EQUIPO).insert({
    equipo_id: doc.equipo_id, path: doc.path, filename: doc.filename, mime: doc.mime, size_bytes: doc.size_bytes, orden, created_by: actor,
  });
  if (error) throw new Error(textoDeError(error, 'No se pudo pasar el documento a foto.'));
  // La fila del documento se va; el archivo queda (ahora lo referencia la foto).
  const { error: de } = await supabase.from('maquinaria_documentos').delete().eq('id', doc.id);
  if (de) throw new Error(textoDeError(de, 'La foto quedó creada pero el documento no se pudo liberar.'));
}

/** Rutas de las fotos de un equipo (antes de eliminar el equipo). */
export async function pathsFotosEquipo(equipoId: string): Promise<string[]> {
  const { data, error } = await supabase.from(TABLA_FOTOS_EQUIPO).select('path').eq('equipo_id', equipoId);
  if (error) throw error;
  return ((data ?? []) as { path: string }[]).map((r) => r.path);
}

/** URLs firmadas (1 h) de varias fotos: path → url. */
export async function urlsFotosEquipo(paths: string[]): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  if (!paths.length) return m;
  const { data, error } = await supabase.storage.from(BUCKET_DOCS_EQUIPO).createSignedUrls(paths, 3600);
  if (error) throw new Error(textoDeError(error, 'No se pudieron abrir las fotos.'));
  for (const d of data ?? []) if (d.path && d.signedUrl) m.set(d.path, d.signedUrl);
  return m;
}
