/* ============================================================
   MGG · Vista previa de reportes (nombres cortos)

   Las pantallas traídas de Golden Touch (Control de Maquinaria, 13-10) piden
   `previewPdf`, `previewArchivo` y `previewExcel`. Acá se enrutan al visor de
   MGG (reportPreview.ts): nada se descarga solo, el usuario decide.
   ============================================================ */
import { previewPdfDoc, previewFileUrl, previewWorkbook } from './reportPreview';

/** Muestra un PDF (jsPDF) en el visor del sistema. */
export function previewPdf(doc: { output: (type: string) => unknown }, filename: string): void {
  previewPdfDoc(doc, filename);
}

/** Vista previa de un archivo ya subido (PDF o imagen) desde su URL firmada. */
export function previewArchivo(url: string, filename = 'archivo'): void {
  void previewFileUrl(url, filename, 'Documento');
}

/** Muestra un libro de Excel (xlsx-js-style) en el visor, con su botón de descarga. */
export async function previewExcel(workbook: unknown, filename: string): Promise<void> {
  const XLSX = await import('xlsx-js-style');
  previewWorkbook(XLSX, workbook, filename);
}
