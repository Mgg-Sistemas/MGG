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
  const limpia = await limpiarFirmaDataUrl(a.firma).catch(() => null);
  const resultado = limpia || { dataUrl: a.firma, w: a.firma_w || 600, h: a.firma_h || 250 };
  cacheFirmasLimpias.set(e, resultado);
  if (limpia && limpia.dataUrl !== a.firma) {
    void supabase.from(TABLE).update({ firma: limpia.dataUrl, firma_w: limpia.w, firma_h: limpia.h }).eq('email', e);
  }
  return resultado;
}

const cacheFirmasLimpias = new Map<string, { dataUrl: string; w: number; h: number }>();

/**
 * Limpia y transparenta cualquier imagen de firma:
 * - Reduce al tamaño óptimo manteniendo la proporción
 * - Detecta adaptativamente el fondo del papel (incluso fotos con sombras o fondo gris)
 * - Vuelve 100% transparente el fondo y resalta el trazo de la tinta en negro carbón
 * - Recorta los márgenes vacíos para que la firma calce perfectamente sobre la línea
 */
export function procesarFirmaTransparente(
  img: HTMLImageElement | HTMLCanvasElement,
  maxW = 700,
): { dataUrl: string; w: number; h: number } {
  const origW = 'naturalWidth' in img ? (img.naturalWidth || img.width) : img.width;
  const origH = 'naturalHeight' in img ? (img.naturalHeight || img.height) : img.height;
  if (!origW || !origH) throw new Error('Dimensiones de firma no disponibles.');

  const escala = Math.min(1, maxW / origW);
  const w = Math.max(1, Math.round(origW * escala));
  const h = Math.max(1, Math.round(origH * escala));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('El navegador no permite procesar canvas 2D.');

  ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h);
  const d = px.data;

  let transparentCount = 0;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] < 200) transparentCount++;
  }
  const yaEsTransparente = transparentCount > (w * h) * 0.05;

  let minX = w, maxX = 0, minY = h, maxY = 0;
  let hayTinta = false;

  if (yaEsTransparente) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) << 2;
        if (d[idx + 3] > 30) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          hayTinta = true;
        }
      }
    }
  } else {
    const lums = new Float32Array(w * h);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      lums[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    }

    const allSorted = Array.from(lums).sort((a, b) => a - b);
    const globalBg = allSorted[Math.floor(allSorted.length * 0.90)] || 240;

    const GRID = 32;
    const cols = Math.max(1, Math.ceil(w / GRID));
    const rows = Math.max(1, Math.ceil(h / GRID));
    const bgGrid = new Float32Array(cols * rows);

    for (let ry = 0; ry < rows; ry++) {
      for (let rx = 0; rx < cols; rx++) {
        const x0 = rx * GRID, y0 = ry * GRID;
        const x1 = Math.min(w, x0 + GRID), y1 = Math.min(h, y0 + GRID);
        const bLums: number[] = [];
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            bLums.push(lums[y * w + x]);
          }
        }
        bLums.sort((a, b) => a - b);
        const pIdx = Math.min(bLums.length - 1, Math.floor(bLums.length * 0.92));
        bgGrid[ry * cols + rx] = Math.max(bLums[pIdx] || globalBg, globalBg - 30);
      }
    }

    for (let y = 0; y < h; y++) {
      const gy = Math.min(rows - 1, Math.floor(y / GRID));
      for (let x = 0; x < w; x++) {
        const gx = Math.min(cols - 1, Math.floor(x / GRID));
        const bg = bgGrid[gy * cols + gx];
        const idx = (y * w + x) << 2;
        const L = lums[y * w + x];
        const delta = bg - L;

        if (delta <= 12) {
          d[idx + 3] = 0;
        } else if (delta >= 34) {
          d[idx] = Math.min(d[idx], 30);
          d[idx + 1] = Math.min(d[idx + 1], 30);
          d[idx + 2] = Math.min(d[idx + 2], 40);
          d[idx + 3] = 255;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          hayTinta = true;
        } else {
          const t = (delta - 12) / (34 - 12);
          d[idx] = Math.min(d[idx], 35);
          d[idx + 1] = Math.min(d[idx + 1], 35);
          d[idx + 2] = Math.min(d[idx + 2], 45);
          d[idx + 3] = Math.round(t * 255);
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          hayTinta = true;
        }
      }
    }
    ctx.putImageData(px, 0, 0);
  }

  if (hayTinta && maxX >= minX && maxY >= minY) {
    const pad = 6;
    const cropX = Math.max(0, minX - pad);
    const cropY = Math.max(0, minY - pad);
    const cropW = Math.min(w - cropX, (maxX - minX + 1) + pad * 2);
    const cropH = Math.min(h - cropY, (maxY - minY + 1) + pad * 2);

    const croppedCanvas = document.createElement('canvas');
    croppedCanvas.width = cropW;
    croppedCanvas.height = cropH;
    const cCtx = croppedCanvas.getContext('2d');
    if (cCtx) {
      cCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
      return { dataUrl: croppedCanvas.toDataURL('image/png'), w: cropW, h: cropH };
    }
  }

  return { dataUrl: canvas.toDataURL('image/png'), w, h };
}

/** Limpia cualquier firma en dataUrl para asegurar fondo transparente */
export async function limpiarFirmaDataUrl(dataUrl: string, maxW = 700): Promise<{ dataUrl: string; w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        resolve(procesarFirmaTransparente(img, maxW));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error('No se pudo decodificar la firma.'));
    img.src = dataUrl;
  });
}

/** Compatibilidad con helpers existentes que esperan formato */
export async function firmaDeCorreo(correo: string | null | undefined): Promise<{ dataUrl: string; formato: 'PNG' | 'JPEG' } | null> {
  const f = await firmaCargadaDe(correo);
  if (!f) return null;
  return { dataUrl: f.dataUrl, formato: 'PNG' };
}

/**
 * Prepara la imagen de firma que sube el usuario: la reduce (máx. 700 px de ancho),
 * vuelve TRANSPARENTE el fondo blanco/grisáceo y la exporta como PNG sin bordes vacíos.
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
    return procesarFirmaTransparente(img, 700);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
