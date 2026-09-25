/* ============================================================
   MGG · Salidas · Adjuntos (Storage + columna jsonb)

   Sube, reemplaza y borra los papeles de una solicitud de salida, traslado o
   salida temporal. Las tres viven en dos tablas distintas pero comparten la
   columna `adjuntos` y el mismo depósito, así que el código es uno solo.

   POR QUÉ SE GUARDA DESPUÉS DE CREAR LA SOLICITUD
   La ruta del archivo lleva el id de la solicitud, y ese id no existe hasta
   que la fila está insertada. Subir primero obligaría a inventar una carpeta
   temporal y después mover todo, que es más cosas que se pueden romper.

   POR QUÉ EL DEPÓSITO ES PRIVADO
   Una nota de salida dice quién retiró, con qué vehículo y hacia dónde. Se
   abre con un enlace firmado que caduca a los 10 minutos.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import {
  MAX_ADJUNTOS_SALIDA, adjuntosDeFila, adjuntosQueQuedan, nombreSeguroAdjunto, recortarAlCupo,
  validarArchivoAdjunto, type AdjuntoSalida,
} from './adjuntosSalida';

const BUCKET = 'salidas-adjuntos';

/** Las dos tablas que llevan adjuntos. */
export type TablaConAdjuntos = 'solicitudes_salida' | 'solicitudes_salida_temporal';

/** Cuánto vive el enlace de descarga. Lo que tarda alguien en mirarlo. */
const MINUTOS_ENLACE = 10;

/**
 * Deja los adjuntos de una solicitud como quedaron: sube los nuevos, conserva
 * los que siguen y borra del depósito los que se quitaron.
 *
 * Devuelve la lista final, que es la que queda guardada en la fila.
 *
 * El borrado del Storage es best-effort a propósito: si falla, queda un
 * archivo huérfano que no molesta a nadie, y lo que importa —que la solicitud
 * deje de mostrarlo— ya está hecho. Al revés sería peor: fallar el guardado
 * entero porque no se pudo borrar un archivo viejo.
 */
export async function guardarAdjuntosSolicitud(
  tabla: TablaConAdjuntos,
  solicitudId: string,
  nuevos: File[] = [],
  existentes: AdjuntoSalida[] = [],
  quitarPaths: string[] = [],
): Promise<AdjuntoSalida[]> {
  // El formulario ya avisa cuando se pasan; acá se recorta para que un camino
  // raro guarde cuatro en vez de que la base rechace el update entero y la
  // solicitud se quede sin ningún adjunto.
  const aSubir = recortarAlCupo(nuevos, existentes, quitarPaths);
  const subidas: AdjuntoSalida[] = [];
  for (const f of aSubir) {
    const malo = validarArchivoAdjunto(f);
    if (malo) throw new Error(malo);
    const rand = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.round(Math.random() * 1e9)}`).slice(0, 8);
    const path = `${solicitudId}/${rand}-${nombreSeguroAdjunto(f.name)}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, f, {
      upsert: false, contentType: f.type || 'application/octet-stream',
    });
    if (error) throw error;
    subidas.push({ path, filename: f.name });
  }

  const finales = [...adjuntosQueQuedan(existentes, quitarPaths), ...subidas].slice(0, MAX_ADJUNTOS_SALIDA);
  const { error } = await supabase.from(tabla).update({ adjuntos: finales }).eq('id', solicitudId);
  if (error) {
    // El update se cayó: los archivos que acabo de subir no los referencia
    // nadie. Se limpian para no dejar basura en el depósito.
    if (subidas.length) {
      try { await supabase.storage.from(BUCKET).remove(subidas.map((a) => a.path)); } catch { /* ya es basura igual */ }
    }
    throw error;
  }
  if (quitarPaths.length) {
    try { await supabase.storage.from(BUCKET).remove(quitarPaths); } catch { /* el Storage no bloquea */ }
  }
  return finales;
}

/**
 * Sube los adjuntos elegidos en un formulario de ALTA, una vez que la
 * solicitud ya existe y tiene id.
 *
 * No lanza: la solicitud ya está creada y perderla por un adjunto que no subió
 * sería peor. Devuelve el motivo para avisarlo, o `null` si salió todo bien.
 */
export async function subirAdjuntosNuevos(
  tabla: TablaConAdjuntos, solicitudId: string, nuevos: File[],
): Promise<string | null> {
  if (!nuevos?.length) return null;
  try {
    await guardarAdjuntosSolicitud(tabla, solicitudId, nuevos);
    return null;
  } catch (e) {
    return e instanceof Error
      ? `La solicitud se creó, pero los adjuntos no se subieron: ${e.message}`
      : 'La solicitud se creó, pero los adjuntos no se subieron.';
  }
}

/** Enlace temporal para ver o bajar un adjunto. Caduca a los 10 minutos. */
export async function urlAdjuntoSalida(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * MINUTOS_ENLACE);
  if (error) throw error;
  return data.signedUrl;
}

/** Enlace que fuerza la descarga con el nombre original. */
export async function urlDescargaAdjuntoSalida(a: AdjuntoSalida): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET)
    .createSignedUrl(a.path, 60 * MINUTOS_ENLACE, { download: a.filename || true });
  if (error) throw error;
  return data.signedUrl;
}

/**
 * Los adjuntos de una fila, ya en forma.
 *
 * La columna es `jsonb`, así que lo que llega puede ser cualquier cosa: una
 * fila vieja sin la columna, un `null`, o algo que quedó a medias.
 */
export function adjuntosDeSolicitud(fila: { adjuntos?: unknown } | null | undefined): AdjuntoSalida[] {
  return adjuntosDeFila(fila?.adjuntos);
}

/**
 * Borra del depósito todos los adjuntos de una solicitud. Se llama al eliminar
 * la solicitud: si no, los archivos quedarían para siempre sin que nadie pueda
 * llegar a ellos. Best-effort, por la misma razón de arriba.
 */
export async function borrarAdjuntosDeSolicitud(fila: { adjuntos?: unknown } | null | undefined): Promise<void> {
  const paths = adjuntosDeSolicitud(fila).map((a) => a.path);
  if (!paths.length) return;
  try { await supabase.storage.from(BUCKET).remove(paths); } catch { /* el Storage no bloquea */ }
}
