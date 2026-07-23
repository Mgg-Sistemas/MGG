/* ============================================================
   MGG · RRHH · Personal (ficha)
   "Usuarios" son los del login; "Personal" engloba a TODO el personal
   a pagar (tengan o no usuario). El sueldo base es MENSUAL (USD).
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import type { Personal } from '@/shared/lib/types';

const TABLE = 'personal';

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

function payload(input: PersonalInput) {
  return {
    nombre: input.nombre.trim(),
    apellido: (input.apellido ?? '').trim(),
    cedula: input.cedula?.trim() || null,
    cargo: input.cargo?.trim() || null,
    departamento: input.departamento?.trim() || null,
    sueldo_base: Math.round((Number(input.sueldo_base) || 0) * 100) / 100,
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

export async function crearPersonal(input: PersonalInput, actorEmail?: string): Promise<Personal> {
  if (!input.nombre.trim()) throw new Error('Indicá el nombre.');
  const { data, error } = await supabase.from(TABLE).insert({ ...payload(input), created_by: actorEmail ?? null }).select('*').single();
  if (error) throw error;
  return data as Personal;
}

export async function actualizarPersonal(id: string, patch: PersonalInput): Promise<Personal> {
  if (!patch.nombre.trim()) throw new Error('Indicá el nombre.');
  const { data, error } = await supabase.from(TABLE).update(payload(patch)).eq('id', id).select('*').single();
  if (error) throw error;
  return data as Personal;
}

/** Solo el sueldo base (para "guardar sueldos" desde la carga de nómina). */
export async function guardarSueldoBase(id: string, sueldoBase: number): Promise<void> {
  const { error } = await supabase.from(TABLE).update({ sueldo_base: Math.round((Number(sueldoBase) || 0) * 100) / 100 }).eq('id', id);
  if (error) throw error;
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
