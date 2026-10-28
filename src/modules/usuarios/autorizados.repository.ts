/* ============================================================
   MGG · Usuarios autorizados (acceso a Supabase)
   Tabla `usuarios_autorizados` (ver supabase/sql/usuarios-autorizados-aprobacion-2026-10-28.sql).
   ============================================================ */
import { useEffect, useSyncExternalStore } from 'react';
import { supabase } from '@/shared/lib/supabase';
import { useRealtime } from '@/shared/lib/useRealtime';
import {
  getAutorizados, setAutorizados, subscribeAutorizados, autorizadoDe, autorizadoPara,
  type UsuarioAutorizado,
} from './autorizados';

const TABLE = 'usuarios_autorizados';
const COLS = 'email, aprobar_oc, aprobar_salidas, firma, firma_w, firma_h, updated_at, updated_by';

export async function listAutorizados(): Promise<UsuarioAutorizado[]> {
  const { data, error } = await supabase.from(TABLE).select(COLS).order('email');
  if (error) throw error;
  return (data ?? []) as UsuarioAutorizado[];
}

let cargando: Promise<void> | null = null;
/** Recarga la lista en memoria (la comparten todas las pantallas). */
export function recargarAutorizados(): Promise<void> {
  cargando ??= listAutorizados()
    .then((l) => setAutorizados(l))
    .catch(() => undefined) // si falla, queda la lista anterior
    .finally(() => { cargando = null; });
  return cargando;
}

/**
 * Lista de usuarios autorizados, cargada una vez y al día por tiempo real.
 * `null` mientras carga. Llamarla en una pantalla hace que se vuelva a pintar
 * cuando la lista cambia (p. ej. el admin quita a alguien).
 */
export function useAutorizados(): UsuarioAutorizado[] | null {
  const lista = useSyncExternalStore(subscribeAutorizados, getAutorizados, getAutorizados);
  useEffect(() => { if (getAutorizados() === null) void recargarAutorizados(); }, []);
  useRealtime([TABLE], () => { void recargarAutorizados(); });
  return lista;
}

/** Hook reactivo para verificar si el usuario actual puede aprobar OC o Salidas. */
export function useAutorizacionAprobar(
  emailOrId?: string | null,
  role?: string | null,
): { aprobarOc: boolean; aprobarSalidas: boolean; cargando: boolean } {
  const lista = useAutorizados();
  if (role === 'admin') {
    return { aprobarOc: true, aprobarSalidas: true, cargando: false };
  }
  const correo = (emailOrId ?? '').trim().toLowerCase();
  if (!correo) {
    return { aprobarOc: false, aprobarSalidas: false, cargando: lista === null };
  }
  const oc = autorizadoPara(correo, 'oc', lista);
  const sal = autorizadoPara(correo, 'salidas', lista);
  if (lista === null) {
    const defaultOc = correo === 'jhzgcontabilidad@gmail.com' || correo === 'mineralgroupguayanaca@gmail.com';
    const defaultSal = correo === 'jhzgcontabilidad@gmail.com' || correo === 'mineralgroupguayanaca@gmail.com';
    return { aprobarOc: defaultOc, aprobarSalidas: defaultSal, cargando: true };
  }
  return { aprobarOc: oc === true, aprobarSalidas: sal === true, cargando: false };
}

/** Crea o actualiza un usuario autorizado (sus opciones y/o su firma). */
export async function guardarAutorizado(
  a: Partial<UsuarioAutorizado> & { email: string }, actorEmail: string,
): Promise<void> {
  const fila = { ...a, email: a.email.trim().toLowerCase(), updated_at: new Date().toISOString(), updated_by: actorEmail };
  const { error } = await supabase.from(TABLE).upsert(fila, { onConflict: 'email' });
  if (error) throw error;
  await recargarAutorizados();
}

/** Quita al usuario de la lista. Lo que ya aprobó queda como está. */
export async function quitarAutorizado(email: string): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq('email', email.trim().toLowerCase());
  if (error) throw error;
  await recargarAutorizados();
}

/**
 * Firma cargada del usuario que aprobó (para los PDF). Busca en memoria y, si
 * la lista no está cargada (PDF abierto desde otra pantalla), la consulta.
 * `null` si ese usuario no tiene firma cargada: el PDF usa la firma de siempre.
 */
export async function firmaCargadaDe(email?: string | null): Promise<{ dataUrl: string; w: number; h: number } | null> {
  const e = (email ?? '').trim().toLowerCase();
  if (!e) return null;
  let a = autorizadoDe(e);
  if (!a && getAutorizados() === null) {
    const { data } = await supabase.from(TABLE).select(COLS).eq('email', e).maybeSingle();
    a = (data as UsuarioAutorizado | null) ?? null;
  }
  if (!a?.firma) return null;
  return { dataUrl: a.firma, w: a.firma_w || 600, h: a.firma_h || 250 };
}

/** Compatibilidad con helpers existentes que esperan formato */
export async function firmaDeCorreo(correo: string | null | undefined): Promise<{ dataUrl: string; formato: 'PNG' | 'JPEG' } | null> {
  const f = await firmaCargadaDe(correo);
  if (!f) return null;
  return { dataUrl: f.dataUrl, formato: 'PNG' };
}

/**
 * Prepara la imagen de firma que sube el usuario: la reduce (máx. 700 px de ancho),
 * vuelve TRANSPARENTE el fondo blanco/claro y la exporta como PNG. Así se estampa
 * limpia sobre la línea de firma de los PDF, igual que las firmas de siempre.
 */
export async function prepararFirma(file: File): Promise<{ dataUrl: string; w: number; h: number }> {
  if (!file.type.startsWith('image/')) throw new Error('La firma debe ser una imagen (PNG o JPG).');
  if (file.size > 8 * 1024 * 1024) throw new Error('La imagen es muy grande (máx. 8 MB).');
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('No se pudo leer la imagen de la firma.'));
      el.src = objectUrl;
    });
    const MAX_W = 700;
    const escala = Math.min(1, MAX_W / (img.naturalWidth || MAX_W));
    const w = Math.max(1, Math.round((img.naturalWidth || 600) * escala));
    const h = Math.max(1, Math.round((img.naturalHeight || 250) * escala));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('El navegador no permite procesar la imagen.');
    ctx.drawImage(img, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h);
    const d = px.data;
    for (let i = 0; i < d.length; i += 4) {
      const min = Math.min(d[i], d[i + 1], d[i + 2]);
      if (min >= 235) d[i + 3] = 0;
      else if (min >= 200) d[i + 3] = Math.min(d[i + 3], Math.round(((235 - min) / 35) * 255));
    }
    ctx.putImageData(px, 0, 0);
    return { dataUrl: canvas.toDataURL('image/png'), w, h };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
