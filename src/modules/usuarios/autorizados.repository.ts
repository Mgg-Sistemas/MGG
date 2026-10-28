/* ============================================================
   MGG · Usuarios autorizados para aprobar (28-10-2026)

   Quién aprueba Órdenes de Compra y Órdenes de Salida ya no está escrito en el
   código: lo define la lista «Usuarios autorizados para:» de Usuarios > Roles y
   Permisos. Cada usuario puede tener Aprobar órdenes de compra, Aprobar salidas
   o ambas, y su firma escaneada, que se estampa en lo que apruebe.

   La base lo exige también (puede_aprobar() en los triggers de salidas y de
   anulación de OC). Lo ya aprobado no se toca.
   SQL: supabase/sql/usuarios-autorizados-aprobacion-2026-10-28.sql
   ============================================================ */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/shared/lib/supabase';
import { useRealtime } from '@/shared/lib/useRealtime';

const TABLE = 'usuarios_autorizados';
export const BUCKET_FIRMAS = 'firmas-usuarios';

export type PermisoAprobacion = 'aprobar_oc' | 'aprobar_salidas';

/** Opciones que se pueden dar a un usuario autorizado (en el orden en que se muestran). */
export const OPCIONES_APROBACION: { key: PermisoAprobacion; label: string; icono: string }[] = [
  { key: 'aprobar_oc', label: 'Aprobar órdenes de compra', icono: '🧾' },
  { key: 'aprobar_salidas', label: 'Aprobar salidas', icono: '📤' },
];

export interface UsuarioAutorizado {
  usuario_id: string;
  aprobar_oc: boolean;
  aprobar_salidas: boolean;
  firma_path: string | null;
  updated_at?: string | null;
  updated_by?: string | null;
}

/** Texto corto de lo que puede aprobar: «Órdenes de compra», «Salidas» o «Órdenes de compra y salidas». */
export function resumenAutorizacion(a: Pick<UsuarioAutorizado, 'aprobar_oc' | 'aprobar_salidas'> | null | undefined): string {
  if (!a) return 'Nada';
  if (a.aprobar_oc && a.aprobar_salidas) return 'Órdenes de compra y salidas';
  if (a.aprobar_oc) return 'Órdenes de compra';
  if (a.aprobar_salidas) return 'Salidas';
  return 'Nada';
}

/** Formato de imagen para jsPDF según el data URL (PNG o JPEG). */
export function formatoImagen(dataUrl: string): 'PNG' | 'JPEG' {
  return /^data:image\/png/i.test(dataUrl) ? 'PNG' : 'JPEG';
}

/** Ruta del archivo de firma de un usuario en el bucket (una por usuario; se reemplaza). */
export function rutaFirma(usuarioId: string, archivo: { name: string; type?: string }): string {
  const ext = /png$/i.test(archivo.type ?? '') || /\.png$/i.test(archivo.name) ? 'png' : 'jpg';
  return `${usuarioId}/firma-${Date.now()}.${ext}`;
}

export async function listAutorizados(): Promise<UsuarioAutorizado[]> {
  const { data, error } = await supabase.from(TABLE).select('*');
  if (error) throw error;
  return (data ?? []) as UsuarioAutorizado[];
}

/** Agrega o actualiza las opciones de un usuario autorizado. */
export async function guardarAutorizado(
  usuarioId: string,
  cambios: Partial<Pick<UsuarioAutorizado, 'aprobar_oc' | 'aprobar_salidas' | 'firma_path'>>,
  actorEmail: string,
): Promise<void> {
  const { error } = await supabase.from(TABLE).upsert(
    { usuario_id: usuarioId, ...cambios, updated_at: new Date().toISOString(), updated_by: actorEmail },
    { onConflict: 'usuario_id' },
  );
  if (error) throw error;
}

/** Saca al usuario de la lista (y borra su firma del bucket). Lo que ya aprobó queda igual. */
export async function quitarAutorizado(a: UsuarioAutorizado): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq('usuario_id', a.usuario_id);
  if (error) throw error;
  if (a.firma_path) await supabase.storage.from(BUCKET_FIRMAS).remove([a.firma_path]).catch(() => undefined);
}

/** Sube (o reemplaza) la firma escaneada del usuario. PNG o JPG, hasta 2 MB. */
export async function subirFirma(a: UsuarioAutorizado | { usuario_id: string; firma_path?: string | null }, file: File, actorEmail: string): Promise<string> {
  if (!/^image\/(png|jpe?g)$/i.test(file.type)) throw new Error('La firma tiene que ser una imagen PNG o JPG.');
  if (file.size > 2 * 1024 * 1024) throw new Error('La imagen de la firma pasa de 2 MB. Achicala y probá de nuevo.');
  const path = rutaFirma(a.usuario_id, file);
  const { error } = await supabase.storage.from(BUCKET_FIRMAS).upload(path, file, { contentType: file.type, upsert: true });
  if (error) throw error;
  await guardarAutorizado(a.usuario_id, { firma_path: path }, actorEmail);
  if (a.firma_path && a.firma_path !== path) {
    await supabase.storage.from(BUCKET_FIRMAS).remove([a.firma_path]).catch(() => undefined);
  }
  return path;
}

export async function quitarFirma(a: UsuarioAutorizado, actorEmail: string): Promise<void> {
  await guardarAutorizado(a.usuario_id, { firma_path: null }, actorEmail);
  if (a.firma_path) await supabase.storage.from(BUCKET_FIRMAS).remove([a.firma_path]).catch(() => undefined);
}

function blobADataUrl(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}

/** Firma (data URL) guardada en el bucket, o null. */
export async function firmaDataUrlDePath(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(BUCKET_FIRMAS).download(path);
  if (error || !data) return null;
  return blobADataUrl(data);
}

/**
 * Firma cargada del usuario que aprobó (por correo), para estampar en el PDF.
 * null si no está en la lista o no tiene firma cargada: el PDF usa entonces la
 * firma de siempre (Leydis / Gerente) o deja la línea vacía.
 */
export async function firmaDeCorreo(correo: string | null | undefined): Promise<{ dataUrl: string; formato: 'PNG' | 'JPEG' } | null> {
  const email = (correo ?? '').trim().toLowerCase();
  if (!email) return null;
  try {
    const { data: u } = await supabase.from('usuarios').select('id').ilike('email', email).maybeSingle();
    if (!u?.id) return null;
    const { data: a } = await supabase.from(TABLE).select('firma_path').eq('usuario_id', u.id).maybeSingle();
    const dataUrl = await firmaDataUrlDePath((a as { firma_path?: string | null } | null)?.firma_path);
    return dataUrl ? { dataUrl, formato: formatoImagen(dataUrl) } : null;
  } catch {
    return null;
  }
}

/**
 * Qué puede aprobar el usuario de la sesión. Se refresca en vivo cuando cambia la
 * lista en Roles y Permisos.
 */
export function useAutorizacionAprobar(usuarioId: string | null | undefined): {
  aprobarOc: boolean; aprobarSalidas: boolean; cargando: boolean;
} {
  const [estado, setEstado] = useState({ aprobarOc: false, aprobarSalidas: false, cargando: true });
  const cargar = useCallback(async () => {
    if (!usuarioId) { setEstado({ aprobarOc: false, aprobarSalidas: false, cargando: false }); return; }
    const { data } = await supabase.from(TABLE).select('aprobar_oc, aprobar_salidas').eq('usuario_id', usuarioId).maybeSingle();
    const a = data as Pick<UsuarioAutorizado, 'aprobar_oc' | 'aprobar_salidas'> | null;
    setEstado({ aprobarOc: !!a?.aprobar_oc, aprobarSalidas: !!a?.aprobar_salidas, cargando: false });
  }, [usuarioId]);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime([TABLE], () => { void cargar(); }, { enabled: !!usuarioId });
  return estado;
}
