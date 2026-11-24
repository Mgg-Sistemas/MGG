/**
 * Vista previa de PDF en teléfonos (12/10/2026).
 *
 * Chrome en Android no muestra un PDF dentro de un iframe (la vista previa quedaba
 * en blanco): ahí las páginas se dibujan en <canvas> con pdf.js. pdf.js se carga
 * solo cuando hace falta, así el escritorio no baja nada de más.
 */

/** true si el navegador no tiene visor de PDF propio (Chrome en Android, entre otros). */
export function navegadorSinVisorPdf(): boolean {
  const nav = navigator as Navigator & { pdfViewerEnabled?: boolean };
  return nav.pdfViewerEnabled === false || /Android/i.test(nav.userAgent);
}

let workerListo = false;

/*
 * Build «legacy» de pdf.js (03/11/2026). El build normal usa Promise.withResolvers y otras
 * novedades que solo trae Chrome 119+ (fines de 2023): en los teléfonos con Chrome o
 * WebView sin actualizar la vista previa caía en «No se pudo mostrar la vista previa…» y el
 * PDF de las salidas del teléfono «no se veía». El legacy trae esos polyfills, también
 * dentro del worker (que es otro contexto: un polyfill en la página no le llega).
 */
export async function cargarPdfjs(): Promise<any> {
  try {
    const pdfjsModulePath = 'pdfjs-dist/legacy/build/pdf.mjs';
    const pdfjs: any = await import(/* @vite-ignore */ pdfjsModulePath).catch(() => null);
    if (!pdfjs) return null;
    if (!workerListo) {
      try {
        const workerPath = 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker';
        const { default: PdfWorker } = await import(/* @vite-ignore */ workerPath as any);
        pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
        workerListo = true;
      } catch {
        /* worker opcional */
      }
    }
    return pdfjs;
  } catch {
    return null;
  }
}

/**
 * Dibuja todas las páginas del PDF en `cont`, una debajo de otra, al ancho de la pantalla.
 * `alCerrar` registra la limpieza: si se cierra la vista previa a mitad, deja de dibujar y suelta el documento.
 */
export async function dibujarPdfEnCanvas(datos: ArrayBuffer, cont: HTMLElement, alCerrar: (fn: () => void) => void): Promise<void> {
  const aviso = document.createElement('div');
  aviso.textContent = 'Cargando vista previa…';
  aviso.style.cssText = 'color:#e6edf3;font:600 .9rem system-ui;text-align:center;padding:1.5rem 1rem;';
  cont.appendChild(aviso);

  let pdf: any = null;
  let cerrado = false;
  alCerrar(() => { cerrado = true; void pdf?.destroy?.(); });
  try {
    const pdfjs = await cargarPdfjs();
    if (!pdfjs) {
      aviso.textContent = 'Visualizador de PDF no disponible en este dispositivo.';
      return;
    }
    pdf = await pdfjs.getDocument({ data: new Uint8Array(datos) }).promise;
    if (cerrado) { void pdf.destroy(); return; }
    aviso.remove();
    const ancho = Math.max(240, Math.min((cont.clientWidth || window.innerWidth) - 16, 1000));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (let n = 1; n <= pdf.numPages && !cerrado; n++) {
      const pagina = await pdf.getPage(n);
      const base = pagina.getViewport({ scale: 1 });
      const vista = pagina.getViewport({ scale: (ancho / base.width) * dpr });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vista.width);
      canvas.height = Math.floor(vista.height);
      canvas.setAttribute('aria-label', `Página ${n} de ${pdf.numPages}`);
      canvas.style.cssText = `display:block;width:${ancho}px;max-width:100%;height:auto;margin:8px auto;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.5);`;
      cont.appendChild(canvas);
      const ctx = canvas.getContext('2d');
      if (!ctx) break;
      await pagina.render({ canvasContext: ctx, viewport: vista }).promise;
    }
  } catch {
    if (cerrado) return;
    aviso.textContent = 'No se pudo mostrar la vista previa en este teléfono. Usa «⬇ Descargar» para verlo.';
  }
}

/** Una página del PDF ya dibujada como imagen, con su tamaño real en puntos. */
export interface HojaImagen { url: string; anchoPt: number; altoPt: number }

/**
 * Dibuja cada página del PDF como imagen PNG a `dpi` (para imprimir hoja por hoja).
 * Devuelve las URL de los blobs; quien las pide las suelta con URL.revokeObjectURL.
 */
export async function paginasPdfComoImagenes(datos: ArrayBuffer, dpi = 200): Promise<HojaImagen[]> {
  const pdfjs = await cargarPdfjs();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(datos) }).promise;
  const hojas: HojaImagen[] = [];
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      const pagina = await pdf.getPage(n);
      const base = pagina.getViewport({ scale: 1 });
      const vista = pagina.getViewport({ scale: dpi / 72 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vista.width);
      canvas.height = Math.floor(vista.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Sin canvas 2D');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await pagina.render({ canvasContext: ctx, viewport: vista }).promise;
      const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/png'));
      canvas.width = 0; canvas.height = 0;
      if (!blob) throw new Error('No se pudo dibujar la página');
      hojas.push({ url: URL.createObjectURL(blob), anchoPt: base.width, altoPt: base.height });
    }
    return hojas;
  } catch (e) {
    hojas.forEach((h) => URL.revokeObjectURL(h.url));
    throw e;
  } finally {
    void pdf.destroy();
  }
}
