/* ============================================================
   MGG · RRHH · Personal (ficha)
   "Usuarios" son los del login; "Personal" engloba a TODO el personal
   a pagar (tengan o no usuario). El sueldo base es MENSUAL (USD).
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { todasLasFilas } from '@/shared/lib/todasLasFilas';
import type { Personal } from '@/shared/lib/types';
import { aCentavos, huboCambioSueldo, validarCambioSueldo, type TipoCambioSueldo } from './cambioSueldo';
import {
  nombreSeguro, validarArchivoDocumento, type TipoDocumentoPersonal,
} from './documentosPersonal';

const TABLE = 'personal';
const TABLA_SUELDOS = 'personal_sueldos';
const TABLA_DOCS = 'personal_documentos';

/** Lista el personal, ordenado por departamento y nombre. */
export async function listPersonal(soloActivos = false): Promise<Personal[]> {
  let q = supabase.from(TABLE).select('*').order('departamento', { ascending: true, nullsFirst: false }).order('nombre', { ascending: true });
  if (soloActivos) q = q.eq('activo', true);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Personal[];
}

export interface PersonalInput {
  nombre: string;
  apellido?: string;
  cedula?: string | null;
  rif?: string | null;
  cargo?: string | null;
  departamento?: string | null;
  sueldo_base?: number;
  fecha_ingreso?: string | null;
  telefono?: string | null;
  contacto_emergencia?: string | null;
  contacto_emergencia_tlf?: string | null;
  foto_url?: string | null;
  /** Encuadre de la foto del carnet: posición 0..1 (default 0,5) y zoom ≥1 (default 1). */
  foto_pos_x?: number | null;
  foto_pos_y?: number | null;
  foto_zoom?: number | null;
}

const BUCKET_FOTOS = 'carnet-fotos';

/** Acota un valor entre min y max. */
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Sube la foto del carnet y devuelve su URL pública. Valida que sea imagen ≤ 5 MB. */
export async function subirFotoCarnet(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('La foto debe ser una imagen (JPG o PNG).');
  if (file.size > 5 * 1024 * 1024) throw new Error('La foto no puede superar 5 MB.');
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const rand = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.round(Math.random() * 1e9)}`);
  const path = `fotos/${rand}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET_FOTOS).upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET_FOTOS).getPublicUrl(path);
  return data.publicUrl;
}

/** Borra del Storage la foto del carnet (por su URL pública). No lanza si ya no existe. */
export async function borrarFotoCarnet(url: string): Promise<void> {
  const marca = `/${BUCKET_FOTOS}/`;
  const i = url.indexOf(marca);
  if (i < 0) return;
  const path = url.slice(i + marca.length);
  try { await supabase.storage.from(BUCKET_FOTOS).remove([path]); } catch { /* el Storage no bloquea */ }
}

/**
 * Los campos de la ficha, SIN el sueldo.
 *
 * El sueldo no viaja en el update común a propósito: la base lo rechaza si no
 * viene con su motivo (`cambiar_sueldo_personal`). Ver `cambiarSueldo`.
 */
function payload(input: PersonalInput) {
  return {
    nombre: input.nombre.trim(),
    apellido: (input.apellido ?? '').trim(),
    cedula: input.cedula?.trim() || null,
    rif: input.rif?.trim() || null,
    cargo: input.cargo?.trim() || null,
    departamento: input.departamento?.trim() || null,
    fecha_ingreso: input.fecha_ingreso || null,
    telefono: input.telefono?.trim() || null,
    contacto_emergencia: input.contacto_emergencia?.trim() || null,
    contacto_emergencia_tlf: input.contacto_emergencia_tlf?.trim() || null,
    foto_url: input.foto_url?.trim() || null,
    // Encuadre de la foto (lo ajusta el usuario): posición 0..1 y zoom entre 1 y 4.
    foto_pos_x: clamp(Number(input.foto_pos_x ?? 0.5), 0, 1),
    foto_pos_y: clamp(Number(input.foto_pos_y ?? 0.5), 0, 1),
    foto_zoom: clamp(Number(input.foto_zoom ?? 1), 1, 4),
  };
}

const BUCKET_DOCS = 'personal-docs';

/* ───────── Documentación del trabajador (cédula, RIF, currículum) ───────── */

export interface DocumentoPersonal {
  id: string;
  personalId: string;
  tipo: TipoDocumentoPersonal;
  path: string;
  nombre: string;
  mime: string | null;
  tamano: number | null;
  subidoPor: string | null;
  subidoPorNombre: string | null;
  createdAt: string;
}

function aDocumento(r: Record<string, unknown>): DocumentoPersonal {
  return {
    id: String(r.id),
    personalId: String(r.personal_id),
    tipo: r.tipo as TipoDocumentoPersonal,
    path: String(r.path),
    nombre: String(r.nombre ?? ''),
    mime: (r.mime as string) ?? null,
    tamano: r.tamano == null ? null : Number(r.tamano),
    subidoPor: (r.subido_por as string) ?? null,
    subidoPorNombre: (r.subido_por_nombre as string) ?? null,
    createdAt: String(r.created_at ?? ''),
  };
}

/** Los papeles de una persona. */
export async function listDocumentosPersonal(personalId: string): Promise<DocumentoPersonal[]> {
  const { data, error } = await supabase.from(TABLA_DOCS).select('*')
    .eq('personal_id', personalId).order('tipo', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => aDocumento(r as Record<string, unknown>));
}

/**
 * Los papeles de TODO el personal, para poder marcar en el listado quién los
 * tiene completos. Por páginas: Supabase corta en 1.000 filas sin avisar, y
 * un documento que no llega parecería un papel que falta.
 */
export async function listDocumentosDeTodos(): Promise<DocumentoPersonal[]> {
  const filas = await todasLasFilas<Record<string, unknown>>((d, h) =>
    supabase.from(TABLA_DOCS).select('*').order('personal_id').order('tipo').range(d, h));
  return filas.map((r) => aDocumento(r));
}

/**
 * Sube (o reemplaza) un documento. El bucket es PRIVADO: son papeles de
 * identidad, no van al bucket público donde vive la foto del carnet.
 *
 * Reemplazar borra el archivo viejo del Storage DESPUÉS de que la fila nueva
 * quedó guardada. Al revés se corre el riesgo de quedarse sin ninguno de los
 * dos si algo falla en el medio.
 */
export async function subirDocumentoPersonal(
  personalId: string,
  tipo: TipoDocumentoPersonal,
  file: File,
  quien: { actor?: string | null; actorName?: string | null } = {},
): Promise<DocumentoPersonal> {
  const falla = validarArchivoDocumento(file);
  if (falla) throw new Error(falla);

  const previo = await documentoDe(personalId, tipo).catch(() => null);

  const rand = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const path = `${tipo}/${personalId}/${rand}_${nombreSeguro(file.name)}`;
  const { error: errSubir } = await supabase.storage.from(BUCKET_DOCS)
    .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
  if (errSubir) throw errSubir;

  const fila = {
    personal_id: personalId, tipo, path, nombre: file.name,
    mime: file.type || null, tamano: file.size ?? null,
    subido_por: quien.actor ?? null, subido_por_nombre: quien.actorName ?? null,
    created_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from(TABLA_DOCS)
    .upsert(fila, { onConflict: 'personal_id,tipo' }).select('*').single();
  if (error) {
    // La fila no quedó: el archivo recién subido sobra, se limpia.
    await supabase.storage.from(BUCKET_DOCS).remove([path]).catch(() => { /* el Storage no bloquea */ });
    throw error;
  }

  if (previo && previo.path !== path) {
    await supabase.storage.from(BUCKET_DOCS).remove([previo.path]).catch(() => { /* quedó huérfano, no rompe */ });
  }
  return aDocumento(data as Record<string, unknown>);
}

/** El documento de un tipo, si está cargado. */
export async function documentoDe(personalId: string, tipo: TipoDocumentoPersonal): Promise<DocumentoPersonal | null> {
  const { data, error } = await supabase.from(TABLA_DOCS).select('*')
    .eq('personal_id', personalId).eq('tipo', tipo).maybeSingle();
  if (error) throw error;
  return data ? aDocumento(data as Record<string, unknown>) : null;
}

/** Enlace firmado (10 min). El bucket es privado a propósito. */
export async function urlDocumentoPersonal(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET_DOCS).createSignedUrl(path, 60 * 10);
  if (error) throw error;
  return data.signedUrl;
}

/** Quita el documento: primero la fila, después el archivo. */
export async function borrarDocumentoPersonal(doc: DocumentoPersonal): Promise<void> {
  const { error } = await supabase.from(TABLA_DOCS).delete().eq('id', doc.id);
  if (error) throw error;
  await supabase.storage.from(BUCKET_DOCS).remove([doc.path]).catch(() => { /* el Storage no bloquea */ });
}

/** Enlace firmado del RIF. Se conserva el nombre viejo: lo usa el listado. */
export async function urlDocumentoRif(path: string): Promise<string> {
  return urlDocumentoPersonal(path);
}

/** Solo los dígitos: «V-12.345.678», «V12345678» y «12345678» son la misma persona. */
export const digitosCedula = (v: string | null | undefined): string =>
  String(v ?? '').replace(/[^0-9]/g, '');

/**
 * ¿Ya hay otra ficha con esa cédula? Devuelve a quién pertenece, para poder
 * decirlo con nombre y apellido en vez de un error seco.
 *
 * La guarda REAL es el índice único de la base (`personal_cedula_unica_idx`):
 * dos personas cargando a la vez desde dos máquinas pasan esta consulta al
 * mismo tiempo. Acá se consulta antes solo para dar un mensaje entendible.
 */
export async function personalConCedula(cedula: string, excluirId?: string): Promise<Personal | null> {
  const digitos = digitosCedula(cedula);
  if (!digitos) return null;
  // Por páginas: Supabase corta en 1.000 filas sin avisar, y una ficha que no
  // llega en la respuesta parecería una cédula libre que en realidad está tomada.
  const filas = await todasLasFilas<Pick<Personal, 'id' | 'nombre' | 'apellido' | 'cedula'>>((d, h) =>
    supabase.from(TABLE).select('id, nombre, apellido, cedula').not('cedula', 'is', null).order('id').range(d, h));
  const encontrado = filas.find((p) => digitosCedula(p.cedula) === digitos && p.id !== excluirId);
  return (encontrado as Personal) ?? null;
}

/** Traduce el choque del índice único a algo que se entienda. */
function errorCedulaRepetida(e: unknown, cedula: string | null | undefined): Error {
  const msg = e instanceof Error ? e.message : String(e);
  if (/personal_cedula_unica_idx|duplicate key/i.test(msg)) {
    return new Error(`Ya hay otra persona registrada con la cédula ${cedula ?? ''}. Revisá el listado: no puede haber dos fichas con la misma cédula.`);
  }
  return e instanceof Error ? e : new Error(msg);
}

async function verificarCedulaLibre(cedula: string | null | undefined, excluirId?: string): Promise<void> {
  const digitos = digitosCedula(cedula);
  if (!digitos) return;
  const otro = await personalConCedula(digitos, excluirId).catch(() => null);
  if (otro) {
    const quien = `${otro.nombre} ${otro.apellido ?? ''}`.trim();
    throw new Error(`La cédula ${cedula} ya es de ${quien}. No puede haber dos fichas con la misma cédula.`);
  }
}

/**
 * Alta de una ficha. Acá el sueldo SÍ va en el insert: no hay un sueldo
 * anterior que pisar. El renglón inicial del historial lo escribe sola la
 * base (trigger `trg_personal_sueldo_inicial`).
 */
export async function crearPersonal(input: PersonalInput, actorEmail?: string): Promise<Personal> {
  if (!input.nombre.trim()) throw new Error('Indicá el nombre.');
  await verificarCedulaLibre(input.cedula);
  const { data, error } = await supabase.from(TABLE).insert({
    ...payload(input),
    sueldo_base: aCentavos(input.sueldo_base),
    created_by: actorEmail ?? null,
  }).select('*').single();
  if (error) throw errorCedulaRepetida(error, input.cedula);
  return data as Personal;
}

/** Lo que hace falta para poder mover un sueldo. */
export interface CambioSueldoOpts {
  motivo?: string | null;
  tipo?: TipoCambioSueldo | null;
  /** Desde cuándo rige el nuevo sueldo. Por defecto, hoy. */
  vigenteDesde?: string | null;
  actor?: string | null;
  actorName?: string | null;
}

/**
 * Edita la ficha. Si además cambió el sueldo, lo mueve por la puerta que exige
 * el motivo, en dos pasos deliberados:
 *
 * 1º el sueldo, porque ahí está la regla que puede rechazar el guardado;
 * 2º el resto de la ficha.
 *
 * Si el sueldo se rechaza (sin motivo, sin permiso), no se toca nada más: no
 * queda una ficha a medias. El paso del sueldo es atómico en la base — el
 * renglón del historial y el nuevo sueldo entran o no entran juntos.
 */
export async function actualizarPersonal(
  id: string,
  patch: PersonalInput,
  cambio: CambioSueldoOpts = {},
): Promise<Personal> {
  if (!patch.nombre.trim()) throw new Error('Indicá el nombre.');
  // Al editar se excluye la propia ficha: cambiar el cargo no puede chocar consigo misma.
  await verificarCedulaLibre(patch.cedula, id);

  // El sueldo anterior se lee de la BASE, no de la pantalla: si otro lo movió
  // mientras esta ficha estaba abierta, el historial tiene que decir la verdad.
  const { data: actual, error: errLeer } = await supabase
    .from(TABLE).select('sueldo_base').eq('id', id).maybeSingle();
  if (errLeer) throw errLeer;
  const anterior = Number(actual?.sueldo_base) || 0;
  const nuevo = aCentavos(patch.sueldo_base);

  if (huboCambioSueldo(anterior, nuevo)) {
    const falla = validarCambioSueldo({ anterior, nuevo, motivo: cambio.motivo, vigenteDesde: cambio.vigenteDesde });
    if (falla) throw new Error(falla);
    await cambiarSueldo(id, nuevo, cambio);
  }

  const { data, error } = await supabase.from(TABLE).update(payload(patch)).eq('id', id).select('*').single();
  if (error) throw errorCedulaRepetida(error, patch.cedula);
  return data as Personal;
}

/**
 * Mueve el sueldo de una persona. Es la ÚNICA forma: un `update` directo de
 * `sueldo_base` lo rechaza la base, justamente para que no exista un cambio
 * de sueldo sin su motivo y sin su renglón en el historial.
 */
export async function cambiarSueldo(id: string, sueldoNuevo: number, cambio: CambioSueldoOpts): Promise<Personal> {
  const { data, error } = await supabase.rpc('cambiar_sueldo_personal', {
    p_personal_id: id,
    p_sueldo_nuevo: aCentavos(sueldoNuevo),
    p_motivo: (cambio.motivo ?? '').trim(),
    p_tipo: cambio.tipo ?? null,
    p_vigente_desde: cambio.vigenteDesde || null,
    p_actor: cambio.actor ?? null,
    p_actor_name: cambio.actorName ?? null,
  });
  if (error) throw new Error(error.message || 'No se pudo cambiar el sueldo.');
  return data as Personal;
}

/* ───────── Historial de sueldos ───────── */

export interface CambioSueldoRegistro {
  id: string;
  personalId: string;
  sueldoAnterior: number;
  sueldoNuevo: number;
  vigenteDesde: string;
  motivo: string;
  tipo: TipoCambioSueldo | null;
  actor: string | null;
  actorName: string | null;
  createdAt: string;
}

function aCambio(r: Record<string, unknown>): CambioSueldoRegistro {
  return {
    id: String(r.id),
    personalId: String(r.personal_id),
    sueldoAnterior: Number(r.sueldo_anterior) || 0,
    sueldoNuevo: Number(r.sueldo_nuevo) || 0,
    vigenteDesde: String(r.vigente_desde ?? '').slice(0, 10),
    motivo: String(r.motivo ?? ''),
    tipo: (r.tipo as TipoCambioSueldo) ?? null,
    actor: (r.actor as string) ?? null,
    actorName: (r.actor_name as string) ?? null,
    createdAt: String(r.created_at ?? ''),
  };
}

/** El historial de una persona, del cambio más nuevo al más viejo. */
export async function listHistorialSueldo(personalId: string): Promise<CambioSueldoRegistro[]> {
  const { data, error } = await supabase.from(TABLA_SUELDOS).select('*')
    .eq('personal_id', personalId)
    .order('vigente_desde', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => aCambio(r as Record<string, unknown>));
}

/** Todos los cambios de sueldo, para ver el movimiento de la nómina completa. */
export async function listCambiosSueldo(desde?: string, hasta?: string): Promise<CambioSueldoRegistro[]> {
  const filas = await todasLasFilas<Record<string, unknown>>((d, h) => {
    let q = supabase.from(TABLA_SUELDOS).select('*')
      .order('vigente_desde', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(d, h);
    if (desde) q = q.gte('vigente_desde', desde);
    if (hasta) q = q.lte('vigente_desde', hasta);
    return q;
  });
  return filas.map((r) => aCambio(r));
}

/** Activa o desactiva (no borra: conserva el histórico de pagos). */
export async function setPersonalActivo(id: string, activo: boolean): Promise<void> {
  const { error } = await supabase.from(TABLE).update({ activo }).eq('id', id);
  if (error) throw error;
}

/** Elimina definitivamente una persona del personal. */
export async function eliminarPersonal(id: string): Promise<void> {
  const { data, error } = await supabase.from(TABLE).delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data || data.length === 0) throw new Error('No se pudo eliminar: sin permiso o ya no existía.');
}
