/* ============================================================
   Golden Touch · Compresor Unificado de Archivos (Imágenes y PDFs)
   (21/11/2026)

   Punto único de optimización previo a la subida a Supabase Storage:
   - Imágenes (JPEG, PNG, HEIC, WebP): procesadas por `comprimirImagen`.
   - Documentos (PDF escaneados de 25-50 MB): optimizados por `comprimirPdf`.
   - Garantiza que ningún archivo pesado no optimizado sature la cuota del sistema.
   ============================================================ */

import { comprimirImagen } from './comprimirImagen';
import { comprimirPdf } from './comprimirPdf';

export interface OpcionesComprimirArchivo {
  calidad?: number;
  dpi?: number;
  onProgreso?: (actual: number, total: number, mensaje?: string) => void;
}

/**
 * Optimiza cualquier archivo admisible (imagen o PDF) antes de su almacenamiento en Storage.
 */
export async function comprimirArchivo(
  file: File,
  opciones?: OpcionesComprimirArchivo,
): Promise<File> {
  const nombre = (file.name || '').toLowerCase();
  const tipo = (file.type || '').toLowerCase();

  if (tipo === 'application/pdf' || nombre.endsWith('.pdf')) {
    return comprimirPdf(file, {
      calidad: opciones?.calidad,
      dpi: opciones?.dpi,
      onProgreso: opciones?.onProgreso,
    });
  }

  if (tipo.startsWith('image/') || /\.(png|jpe?g|webp|heic)$/i.test(nombre)) {
    return comprimirImagen(file, {
      calidad: opciones?.calidad,
    });
  }

  return file;
}
