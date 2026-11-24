/* ============================================================
   Golden Touch · Retenciones · Validación y gestión de adjuntos
   para el Buzón de Facturas Móvil

   Reglas estrictas:
   - Máximo 4 imágenes (JPG, PNG, WEBP).
   - Máximo 2 documentos PDF.
   - Máximo 12 MB por archivo.
   ============================================================ */

import { supabase } from '@/shared/lib/supabase';
import { comprimirImagen } from '@/shared/lib/comprimirImagen';
import { errorStorage } from '@/modules/libroFiscal/erroresRetencion';

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

/** ¿Es una foto HEIC/HEIF de iPhone? Se detecta por tipo o por extensión (a veces el tipo llega vacío). */
export function esHeic(f: File): boolean {
  return /hei[cf]/i.test(f.type) || /\.hei[cf]$/i.test(f.name);
}

/** Mensaje claro para una foto HEIC de iPhone que no se puede guardar. */
const mensajeHeic = (nombre: string) =>
  `La foto «${nombre}» está en formato HEIC/HEIF de iPhone y no se puede guardar directamente. `
  + 'En el iPhone, cambia Ajustes › Cámara › Formato a «Más compatible» (así salen en JPG), '
  + 'o abre la foto y súbela como captura de pantalla.';

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
    const heic = otros.find(esHeic);
    return {
      imagenes: [],
      pdfs: [],
      valido: false,
      error: heic
        ? mensajeHeic(heic.name)
        : `El archivo «${otros[0].name}» no es compatible. Solo se admiten imágenes (JPG/PNG) y documentos PDF.`,
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

/** Los tipos que acepta el almacenamiento del buzón (el resto se rechaza al subir). */
export const TIPOS_GUARDABLES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

/**
 * Achica las fotos antes de subirlas (salen en JPEG). Una foto que el navegador
 * no puede convertir (p. ej. HEIC del iPhone) no se puede guardar: se avisa
 * antes de subir nada.
 */
export async function prepararImagenesParaSubida(imagenes: readonly File[]): Promise<File[]> {
  const listas: File[] = [];
  for (const img of imagenes) {
    let lista = img;
    try {
      lista = await comprimirImagen(img, { maximo: 1920, calidad: 0.82 });
    } catch {
      /* se queda la original; abajo se ve si se puede guardar */
    }
    if (!TIPOS_GUARDABLES.includes(lista.type)) {
      throw new Error(esHeic(img)
        ? mensajeHeic(img.name)
        : `La foto «${img.name}» está en un formato que no se puede guardar (solo JPG, PNG o WEBP). Tómala de nuevo con la cámara en formato JPG o haz una captura de pantalla de ella.`);
    }
    listas.push(lista);
  }
  return listas;
}

export async function prepararAdjuntosBuzon(archivos: readonly File[]): Promise<File[]> {
  const { imagenes, pdfs } = clasificarArchivos(archivos);
  const imgsListas = await prepararImagenesParaSubida(imagenes);
  return [...imgsListas, ...pdfs];
}

/**
 * Sube un archivo de una factura del buzón, antes de guardar la factura (quien
 * solo tiene lectura carga facturas, pero no puede modificarlas después). Si no
 * se sube, se avisa: un soporte que no está en el almacenamiento no se registra.
 */
export async function subirArchivoBuzon(facturaId: string, archivo: File): Promise<AdjuntoFacturaItem> {
  const tipo = archivo.type.startsWith('image/') ? 'imagen' : 'pdf';
  // La base acepta «<id de la factura>/<nombre>», con el nombre de hasta 200 caracteres.
  const safeName = archivo.name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.{2,}/g, '.').slice(-150);
  const path = `${facturaId}/${Date.now()}_${safeName}`;

  const { data, error } = await supabase.storage.from(BUCKET_BUZON).upload(path, archivo, {
    upsert: false,
    contentType: archivo.type,
  });
  if (error) throw errorStorage(error, `el archivo «${archivo.name}»`);

  return {
    id: crypto.randomUUID(),
    facturaId,
    tipo,
    path: data?.path ?? path,
    nombreOriginal: archivo.name,
    nombre: archivo.name,
    tamanoBytes: archivo.size,
    size: archivo.size,
    mimeType: archivo.type,
    createdAt: new Date().toISOString(),
  };
}

/** Borra archivos ya subidos (cuando la factura no se llegó a guardar o se borra). */
export async function borrarArchivosBuzon(paths: readonly string[]): Promise<void> {
  if (!paths.length) return;
  const { error } = await supabase.storage.from(BUCKET_BUZON).remove([...paths]);
  if (error) throw new Error('No se pudieron borrar los archivos de la factura. Vuelve a intentarlo.');
}

/** Minutos que vale el enlace firmado de un soporte (el mismo que usa el diseño aprobado). */
export const MINUTOS_ENLACE_ADJUNTO = 10;

/**
 * Enlace firmado de un adjunto, válido diez minutos. Los soportes de las facturas
 * nunca se sirven con enlace público.
 */
export async function obtenerUrlAdjunto(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET_BUZON).createSignedUrl(path, MINUTOS_ENLACE_ADJUNTO * 60);
  if (error || !data?.signedUrl) throw new Error('No se pudo abrir el archivo: sin permiso, o ya no está guardado.');
  return data.signedUrl;
}
