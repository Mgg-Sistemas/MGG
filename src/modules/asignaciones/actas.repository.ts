/* ============================================================
   MGG · Asignaciones · Actas de entrega (lectura y escritura)

   Una fila por entrega: número correlativo (NNN-AAAA), quién entrega
   (foto fija de nombre, cédula y cargo), a quién, las fotos del anexo
   fotográfico y el escaneo del acta ya firmada. Los ítems son las filas
   de `asignaciones` con ese `acta_id`.

   Los archivos van al bucket privado `personal-docs` (el de RRHH) bajo
   asignaciones/<acta_id>/… — sus políticas ya cubren a todo usuario
   registrado. Instalación: supabase/sql/asignaciones-actas.sql.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { todasLasFilas } from '@/shared/lib/todasLasFilas';
import type { Personal } from '@/shared/lib/types';
import { nombreSeguro } from '@/modules/rrhh/documentosPersonal';
import { MAX_FOTOS_ACTA, errorFotosActa, nombreCorto } from './actas';

const TABLE = 'asignaciones_actas';
const BUCKET = 'personal-docs';

export interface FotoActa { path: string; filename: string }

export interface ActaAsignacion {
  id: string;
  numero: string;
  fecha: string;
  personal_id: string;
  entrega_personal_id?: string | null;
  entrega_nombre?: string | null;
  entrega_cedula?: string | null;
  entrega_cargo?: string | null;
  observaciones?: string | null;
  fotos: FotoActa[];
  firmada_path?: string | null;
  firmada_nombre?: string | null;
  firmada_at?: string | null;
  firmada_por?: string | null;
  historico: boolean;
  creado_por?: string | null;
  actor_name?: string | null;
  created_at: string;
  updated_at?: string | null;
}

export interface ActaInput {
  /** Vacío = el siguiente del año (lo pone la base con candado). */
  numero?: string | null;
  fecha: string;
  personal_id: string;
  /** Quién entrega por la empresa (ficha de RRHH); de ella se copian nombre, cédula y cargo. */
  entrega?: Pick<Personal, 'id' | 'nombre' | 'apellido' | 'cedula' | 'cargo'> | null;
  observaciones?: string | null;
  historico?: boolean;
}

/** ¿El error es «la tabla no existe»? (falta correr el SQL de instalación). */
export function esTablaFaltante(e: unknown): boolean {
  const o = (e ?? {}) as { code?: string; message?: string };
  const msg = String(o.message ?? '');
  return o.code === '42P01' || o.code === 'PGRST205' || /does not exist|Could not find the table/i.test(msg);
}

function err(e: unknown, fallback: string): Error {
  if (esTablaFaltante(e)) return new Error('Las actas de entrega todavía no están instaladas en la base: hay que ejecutar supabase/sql/asignaciones-actas.sql.');
  if (e && typeof e === 'object' && 'code' in e && (e as { code?: string }).code === '23505') return new Error('Ya existe un acta con ese número.');
  return e instanceof Error ? e : new Error(fallback);
}

function normalizar(r: Record<string, unknown>): ActaAsignacion {
  return { ...(r as unknown as ActaAsignacion), fotos: Array.isArray(r.fotos) ? (r.fotos as FotoActa[]) : [], historico: r.historico === true };
}

/** Todas las actas (por páginas: Supabase corta en 1.000 sin avisar). Relanza si la tabla no existe: la página decide qué mostrar. */
export async function listActas(): Promise<ActaAsignacion[]> {
  const filas = await todasLasFilas<Record<string, unknown>>((desde, hasta) =>
    supabase.from(TABLE).select('*').order('fecha', { ascending: false }).order('created_at', { ascending: false }).range(desde, hasta));
  return filas.map(normalizar);
}

export async function crearActa(input: ActaInput, a: { actor: string; actorName?: string | null }): Promise<ActaAsignacion> {
  const e = input.entrega ?? null;
  const { data, error } = await supabase.from(TABLE).insert({
    numero: (input.numero ?? '').trim() || null,
    fecha: input.fecha,
    personal_id: input.personal_id,
    entrega_personal_id: e?.id ?? null,
    entrega_nombre: e ? nombreCorto(e) : null,
    entrega_cedula: e?.cedula ?? null,
    entrega_cargo: e?.cargo ?? null,
    observaciones: (input.observaciones ?? '').trim() || null,
    historico: input.historico === true,
    creado_por: a.actor,
    actor_name: a.actorName ?? null,
  }).select('*').single();
  if (error) throw err(error, 'No se pudo crear el acta.');
  return normalizar(data as Record<string, unknown>);
}

/** Cambia quién entrega (y su foto fija) o la observación del acta. */
export async function actualizarActa(
  id: string,
  patch: { entrega?: ActaInput['entrega']; observaciones?: string | null; fecha?: string },
): Promise<ActaAsignacion> {
  const fila: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.entrega !== undefined) {
    const e = patch.entrega;
    fila.entrega_personal_id = e?.id ?? null;
    fila.entrega_nombre = e ? nombreCorto(e) : null;
    fila.entrega_cedula = e?.cedula ?? null;
    fila.entrega_cargo = e?.cargo ?? null;
  }
  if (patch.observaciones !== undefined) fila.observaciones = (patch.observaciones ?? '').trim() || null;
  if (patch.fecha) fila.fecha = patch.fecha;
  const { data, error } = await supabase.from(TABLE).update(fila).eq('id', id).select('*').single();
  if (error) throw err(error, 'No se pudo guardar el acta.');
  return normalizar(data as Record<string, unknown>);
}

/** Borra el acta y sus archivos. Solo tiene sentido cuando ya no le queda ningún ítem. */
export async function eliminarActa(acta: ActaAsignacion): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq('id', acta.id);
  if (error) throw err(error, 'No se pudo eliminar el acta.');
  const paths = [...acta.fotos.map((f) => f.path), acta.firmada_path ?? ''].filter(Boolean);
  if (paths.length) await supabase.storage.from(BUCKET).remove(paths).catch(() => undefined);
}

/** Si al acta no le queda ningún ítem (se eliminó el último), se va con sus archivos. */
export async function eliminarActaSiVacia(actaId: string): Promise<boolean> {
  const { count } = await supabase.from('asignaciones').select('id', { count: 'exact', head: true }).eq('acta_id', actaId);
  if ((count ?? 0) > 0) return false;
  const { data } = await supabase.from(TABLE).select('*').eq('id', actaId).maybeSingle();
  if (!data) return false;
  await eliminarActa(normalizar(data as Record<string, unknown>));
  return true;
}

/* ───────────── Anexo fotográfico ───────────── */

/** Sube hasta 4 fotos (en total) al anexo del acta y las anota en la fila. */
export async function subirFotosActa(acta: ActaAsignacion, archivos: File[]): Promise<ActaAsignacion> {
  const mal = errorFotosActa(archivos, acta.fotos.length);
  if (mal) throw new Error(mal);
  const nuevas: FotoActa[] = [];
  for (const f of archivos.slice(0, MAX_FOTOS_ACTA - acta.fotos.length)) {
    const path = `asignaciones/${acta.id}/foto-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${nombreSeguro(f.name)}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, f, { upsert: false, contentType: f.type || 'image/jpeg' });
    if (error) throw new Error(`No se pudo subir «${f.name}»: ${error.message}`);
    nuevas.push({ path, filename: f.name });
  }
  const fotos = [...acta.fotos, ...nuevas].slice(0, MAX_FOTOS_ACTA);
  const { data, error } = await supabase.from(TABLE).update({ fotos, updated_at: new Date().toISOString() }).eq('id', acta.id).select('*').single();
  if (error) throw err(error, 'No se pudieron anotar las fotos.');
  return normalizar(data as Record<string, unknown>);
}

export async function quitarFotoActa(acta: ActaAsignacion, path: string): Promise<ActaAsignacion> {
  const fotos = acta.fotos.filter((f) => f.path !== path);
  const { data, error } = await supabase.from(TABLE).update({ fotos, updated_at: new Date().toISOString() }).eq('id', acta.id).select('*').single();
  if (error) throw err(error, 'No se pudo quitar la foto.');
  await supabase.storage.from(BUCKET).remove([path]).catch(() => undefined);
  return normalizar(data as Record<string, unknown>);
}

/** URL firmada (10 min) de una foto o del acta firmada. */
export async function urlArchivoActa(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 10);
  if (error) throw new Error('No se pudo abrir el archivo.');
  return data.signedUrl;
}

/** El archivo como data URL, para meterlo en el PDF (el anexo fotográfico). */
export async function dataUrlArchivoActa(path: string): Promise<string> {
  const url = await urlArchivoActa(path);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('No se pudo descargar la foto.');
  const blob = await resp.blob();
  return new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error('No se pudo leer la foto.'));
    fr.readAsDataURL(blob);
  });
}

/* ───────────── El acta firmada ───────────── */

/** Guarda el escaneo (PDF o imagen) del acta ya firmada; reemplaza el anterior si lo había. */
export async function subirActaFirmada(acta: ActaAsignacion, file: File, actor: string): Promise<ActaAsignacion> {
  const esPdf = /pdf$/i.test(file.type) || /\.pdf$/i.test(file.name);
  if (!esPdf && !(file.type || '').startsWith('image/')) throw new Error('El acta firmada tiene que ser un PDF o una imagen.');
  if (file.size > 10 * 1024 * 1024) throw new Error('El archivo pesa más de 10 MB.');
  const path = `asignaciones/${acta.id}/firmada-${Date.now()}-${nombreSeguro(file.name)}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type || (esPdf ? 'application/pdf' : 'image/jpeg') });
  if (error) throw new Error(`No se pudo subir el acta firmada: ${error.message}`);
  const { data, error: e2 } = await supabase.from(TABLE).update({
    firmada_path: path, firmada_nombre: file.name, firmada_at: new Date().toISOString(), firmada_por: actor, updated_at: new Date().toISOString(),
  }).eq('id', acta.id).select('*').single();
  if (e2) { await supabase.storage.from(BUCKET).remove([path]).catch(() => undefined); throw err(e2, 'No se pudo anotar el acta firmada.'); }
  if (acta.firmada_path) await supabase.storage.from(BUCKET).remove([acta.firmada_path]).catch(() => undefined);
  return normalizar(data as Record<string, unknown>);
}

export async function quitarActaFirmada(acta: ActaAsignacion): Promise<ActaAsignacion> {
  const { data, error } = await supabase.from(TABLE).update({
    firmada_path: null, firmada_nombre: null, firmada_at: null, firmada_por: null, updated_at: new Date().toISOString(),
  }).eq('id', acta.id).select('*').single();
  if (error) throw err(error, 'No se pudo quitar el acta firmada.');
  if (acta.firmada_path) await supabase.storage.from(BUCKET).remove([acta.firmada_path]).catch(() => undefined);
  return normalizar(data as Record<string, unknown>);
}
