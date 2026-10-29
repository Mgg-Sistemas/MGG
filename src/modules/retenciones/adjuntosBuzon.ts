/* ============================================================
   MGG · Retenciones · Validación y gestión de adjuntos
   para el Buzón de Facturas Móvil (alineado con Golden Touch)

   Reglas estrictas:
   - Máximo 4 imágenes (JPG, PNG, WEBP).
   - Máximo 2 documentos PDF.
   - Máximo 12 MB por archivo.
   ============================================================ */

import { supabase } from '@/shared/lib/supabase';
import { comprimirImagen } from '@/shared/lib/comprimirImagen';

export const MAX_IMAGENES_FACTURA = 4;
export const MAX_PDFS_FACTURA = 2;
export const MAX_TOTAL_ADJUNTOS = 6;
export const MAX_TAMANO_BYTES = 12 * 1024 * 1024; // 12 MB
export const BUCKET_BUZON = 'retenciones-facturas-externas';

export const REGLA_BUZON = {
  maxImagenes: MAX_IMAGENES_FACTURA,
  maxPdfs: MAX_PDFS_FACTURA,
  maxTotal: MAX_TOTAL_ADJUNTOS,
  maxBytesPorArchivo: MAX_TAMANO_BYTES,
};

export interface AdjuntoFacturaItem {
  id: string;
  facturaId: string;
  tipo: 'imagen' | 'pdf';
  path: string;
  nombreOriginal: string;
  tamanoBytes: number;
  mimeType: string;
  createdAt: string;
  url?: string;

  // Propiedades espejo para compatibilidad
  nombre?: string;
  size?: number;
}

export interface ValidacionArchivos {
  imagenes: File[];
  pdfs: File[];
  error: string | null;
  valido: boolean;
}

/** Clasifica una lista de archivos en imágenes y PDFs */
export function clasificarArchivos(archivos: readonly File[]): { imagenes: File[]; pdfs: File[]; otros: File[] } {
  const imagenes: File[] = [];
  const pdfs: File[] = [];
  const otros: File[] = [];

  for (const f of archivos) {
    if (f.type.startsWith('image/')) {
      imagenes.push(f);
    } else if (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')) {
      pdfs.push(f);
    } else {
      otros.push(f);
    }
  }

  return { imagenes, pdfs, otros };
}

/** Valida una lista de archivos seleccionados contra los límites (máx 4 fotos, máx 2 PDFs) */
export function validarArchivosFactura(
  archivosNuevos: readonly File[],
  imagenesExistentes = 0,
  pdfsExistentes = 0,
): ValidacionArchivos {
  const { imagenes, pdfs, otros } = clasificarArchivos(archivosNuevos);

  for (const f of archivosNuevos) {
    if (f.size > MAX_TAMANO_BYTES) {
      return {
        imagenes: [],
        pdfs: [],
        valido: false,
        error: `El archivo «${f.name}» supera el tamaño máximo permitido de 12 MB.`,
      };
    }
  }

  if (otros.length > 0) {
    return {
      imagenes: [],
      pdfs: [],
      valido: false,
      error: `El archivo «${otros[0].name}» no es compatible. Solo se admiten imágenes (JPG/PNG) y documentos PDF.`,
    };
  }

  const totalImagenes = imagenesExistentes + imagenes.length;
  if (totalImagenes > MAX_IMAGENES_FACTURA) {
    return {
      imagenes: [],
      pdfs: [],
      valido: false,
      error: `Solo se admiten hasta ${MAX_IMAGENES_FACTURA} imágenes por factura (intentas cargar ${totalImagenes}).`,
    };
  }

  const totalPdfs = pdfsExistentes + pdfs.length;
  if (totalPdfs > MAX_PDFS_FACTURA) {
    return {
      imagenes: [],
      pdfs: [],
      valido: false,
      error: `Solo se admiten 1 o 2 documentos PDF por factura (intentas cargar ${totalPdfs}).`,
    };
  }

  return { imagenes, pdfs, error: null, valido: true };
}

export const validarAdjuntosBuzon = (archivos: readonly File[], imgExist = 0, pdfExist = 0) =>
  validarArchivosFactura(archivos, imgExist, pdfExist);

/** Prepara y comprime imágenes antes de subirlas */
export async function prepararImagenesParaSubida(imagenes: readonly File[]): Promise<File[]> {
  const comprimidas: File[] = [];
  for (const img of imagenes) {
    try {
      const c = await comprimirImagen(img);
      comprimidas.push(c);
    } catch {
      comprimidas.push(img);
    }
  }
  return comprimidas;
}

export async function prepararAdjuntosBuzon(archivos: readonly File[]): Promise<File[]> {
  const { imagenes, pdfs } = clasificarArchivos(archivos);
  const imgsListas = await prepararImagenesParaSubida(imagenes);
  return [...imgsListas, ...pdfs];
}

/** Sube un archivo al bucket de Supabase con fallback seguro */
export async function subirArchivoBuzon(
  archivoOId: File | string,
  facturaIdOArchivo: string | File,
  tipoOpcional?: 'imagen' | 'pdf',
): Promise<AdjuntoFacturaItem> {
  const archivo = archivoOId instanceof File ? archivoOId : (facturaIdOArchivo as File);
  const facturaId = typeof archivoOId === 'string' ? archivoOId : (facturaIdOArchivo as string);
  const tipo = tipoOpcional || (archivo.type.startsWith('image/') ? 'imagen' : 'pdf');

  const timestamp = Date.now();
  const safeName = archivo.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${facturaId}/${timestamp}_${safeName}`;

  let uploadedPath = path;
  try {
    const { data, error } = await supabase.storage.from(BUCKET_BUZON).upload(path, archivo, {
      upsert: true,
      contentType: archivo.type,
    });
    if (error) throw error;
    if (data?.path) uploadedPath = data.path;
  } catch {
    /* Fallback en caso de que storage no esté configurado */
  }

  return {
    id: `adj-${timestamp}-${Math.random().toString(36).slice(2, 6)}`,
    facturaId,
    tipo,
    path: uploadedPath,
    nombreOriginal: archivo.name,
    nombre: archivo.name,
    tamanoBytes: archivo.size,
    size: archivo.size,
    mimeType: archivo.type,
    createdAt: new Date().toISOString(),
  };
}

/** Obtiene la URL pública o firmada de un adjunto */
export function urlPublicaAdjunto(path: string): string {
  if (!path) return '';
  try {
    const { data } = supabase.storage.from(BUCKET_BUZON).getPublicUrl(path);
    return data?.publicUrl || '';
  } catch {
    return path;
  }
}

export async function obtenerUrlAdjunto(path: string): Promise<string> {
  try {
    const { data } = await supabase.storage.from(BUCKET_BUZON).createSignedUrl(path, 3600);
    if (data?.signedUrl) return data.signedUrl;
  } catch {
    /* ignore */
  }
  return urlPublicaAdjunto(path);
}

