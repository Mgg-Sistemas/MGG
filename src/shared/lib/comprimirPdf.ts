/* ============================================================
   Golden Touch · Compresor y Optimizador Inteligente de PDFs en Navegador
   (21/11/2026)

   Protección de cuota y ancho de banda en Supabase Storage:
   - Los documentos legales y mineros (RUPDAE, RAGDA, Actas, Solvencias)
     frecuentemente pesan entre 25 MB y 50 MB debido a que escáneres
     de oficina guardan bitmaps crudos a 300-600 DPI sin compresión.
   - Este módulo procesa el PDF página a página en un canvas off-screen
     a resolución óptima de lectura legal (144-150 DPI, JPEG 0.78),
     reduciendo el peso en un 90% a 95% (de 50 MB a ~1.5 - 3.5 MB).
   - Mantiene la nitidez de sellos húmedos, firmas, números y texto legal.
   - Devuelve el archivo optimizado solo si resulta más liviano que el original.
   ============================================================ */

import { cargarPdfjs } from './pdfCanvas';

export const UMBRAL_BYTES_PDF = 2.5 * 1024 * 1024; // 2.5 MB (archivos menores no requieren compresión)
export const MAX_TAMANO_PDF_BYTES = 150 * 1024 * 1024; // 150 MB (admisión en navegador para optimizar en cliente)

export interface OpcionesCompresionPdf {
  /** Calidad de compresión JPEG para cada página (0.1 a 1.0). Por defecto 0.78 */
  calidad?: number;
  /** DPI de renderizado de cada página (120-180 es ideal para lectura legal). Por defecto 150 */
  dpi?: number;
  /** Callback para reportar avance página por página a la interfaz de usuario */
  onProgreso?: (actual: number, total: number, mensaje?: string) => void;
}

/** Determina si un archivo califica para ser optimizado por ser un PDF pesado */
export function convieneOptimizarPdf(type?: string | null, size?: number | null, nombre?: string | null): boolean {
  if (!size || size <= UMBRAL_BYTES_PDF) return false;
  const esPdf = type === 'application/pdf' || (nombre ? nombre.toLowerCase().endsWith('.pdf') : false);
  return esPdf;
}

/**
 * Optimiza un PDF reduciendo el peso de sus páginas escaneadas mediante renderizado
 * controlado a 150 DPI con compresión JPEG. Devuelve el File optimizado o el original
 * si no fue necesario o si la compresión no generó ahorro.
 */
export async function comprimirPdf(
  file: File,
  opciones?: OpcionesCompresionPdf,
): Promise<File> {
  // Entornos sin DOM (Node.js en tests) o archivos que no ameritan optimización
  if (typeof window === 'undefined' || typeof document === 'undefined') return file;
  if (!convieneOptimizarPdf(file.type, file.size, file.name)) return file;

  try {
    const { jsPDF } = await import('jspdf');
    const pdfjs = await cargarPdfjs();
    if (!pdfjs) return file;

    const buffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
    const numPages = pdf.numPages;

    if (numPages <= 0) {
      void pdf.destroy();
      return file;
    }

    const dpi = opciones?.dpi ?? 150;
    const calidad = opciones?.calidad ?? 0.78;
    const scale = dpi / 72;

    let doc: InstanceType<typeof jsPDF> | null = null;

    for (let n = 1; n <= numPages; n++) {
      if (opciones?.onProgreso) {
        opciones.onProgreso(n, numPages, `Optimizando página ${n} de ${numPages}…`);
      }

      const pagina = await pdf.getPage(n);
      const base = pagina.getViewport({ scale: 1 });
      const vista = pagina.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vista.width);
      canvas.height = Math.floor(vista.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('No se pudo inicializar canvas 2D para compresión.');
      }

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await pagina.render({ canvasContext: ctx, viewport: vista }).promise;

      const jpegData = canvas.toDataURL('image/jpeg', calidad);

      // Limpiar dimensiones del canvas para liberar memoria de GPU/RAM
      canvas.width = 0;
      canvas.height = 0;

      const orientation = base.width > base.height ? 'landscape' : 'portrait';

      if (!doc) {
        doc = new jsPDF({
          unit: 'pt',
          format: [base.width, base.height],
          orientation,
          compress: true,
        });
      } else {
        doc.addPage([base.width, base.height], orientation);
      }

      doc.addImage(jpegData, 'JPEG', 0, 0, base.width, base.height, undefined, 'FAST');
    }

    void pdf.destroy();

    if (!doc) return file;

    const outputBlob = doc.output('blob');

    // Solo adoptamos el archivo si efectivamente redujo su tamaño
    if (outputBlob.size < file.size) {
      return new File([outputBlob], file.name, {
        type: 'application/pdf',
        lastModified: Date.now(),
      });
    }

    return file;
  } catch (err) {
    console.warn(`[comprimirPdf] No se pudo optimizar «${file.name}». Se mantendrá el archivo original:`, err);
    return file;
  }
}
