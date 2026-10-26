/* ============================================================
   MGG · Vista previa de reportes (PDF / Excel / Archivos)
   
   Overlay unificado para previsualización e interactividad en pantalla,
   con soporte completo de controles dinámicos (extraControls),
   impresión sin márgenes y descarga opcional.
   ============================================================ */

import type { jsPDF as JsPDFType } from 'jspdf';
import type { WorkBook } from 'xlsx-js-style';

interface OverlayUI {
  bar: HTMLDivElement;
  body: HTMLDivElement;
  btnDl: HTMLButtonElement;
  btnPrint: HTMLButtonElement;
  close: () => void;
  onClose: (fn: () => void) => void;
}

function buildOverlay(filename: string): OverlayUI {
  const root = document.createElement('div');
  root.style.cssText =
    'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.85);display:flex;flex-direction:column;';

  const bar = document.createElement('div');
  bar.style.cssText =
    'display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;padding:.6rem .9rem;background:#1c2128;border-bottom:1px solid #30363d;';

  const title = document.createElement('div');
  title.style.cssText =
    'margin-right:auto;color:#e6edf3;font:600 .95rem system-ui;display:flex;gap:.5rem;align-items:center;min-width:0;flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  title.textContent = `Vista previa · ${filename}`;

  const btnDl = document.createElement('button');
  btnDl.type = 'button';
  btnDl.textContent = '⬇ Descargar';
  btnDl.style.cssText =
    'background:#ff8a00;color:#111;border:0;border-radius:6px;padding:.5rem .9rem;font:600 .9rem system-ui;cursor:pointer;font-weight:700;';

  const btnPrint = document.createElement('button');
  btnPrint.type = 'button';
  btnPrint.textContent = '🖨 Imprimir';
  btnPrint.title = 'Imprimir';
  btnPrint.style.cssText =
    'background:transparent;color:#e6edf3;border:1px solid #30363d;border-radius:6px;padding:.5rem .9rem;font:600 .9rem system-ui;cursor:pointer;';

  const btnClose = document.createElement('button');
  btnClose.type = 'button';
  btnClose.textContent = '✕ Cerrar';
  btnClose.style.cssText =
    'background:transparent;color:#e6edf3;border:1px solid #ff8a00;border-radius:6px;padding:.5rem .9rem;font:600 .9rem system-ui;cursor:pointer;flex:0 0 auto;';

  const body = document.createElement('div');
  body.style.cssText = 'flex:1;overflow:auto;background:#0d1117;';

  bar.append(title, btnPrint, btnDl, btnClose);
  root.append(bar, body);
  document.body.appendChild(root);

  const closers: Array<() => void> = [() => root.remove()];
  const close = () => closers.forEach((fn) => { try { fn(); } catch { /* noop */ } });
  btnClose.onclick = close;

  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  closers.push(() => document.removeEventListener('keydown', onKey));

  return { bar, body, btnDl, btnPrint, close, onClose: (fn: () => void) => closers.push(fn) };
}

export interface PreviewPdfOpciones {
  extraControls?: (ctx: {
    bar: HTMLElement;
    updatePdf: (nuevoDoc: JsPDFType | any) => void;
    close: () => void;
  }) => void;
}

function imprimirUrlLocal(url: string, ui: OverlayUI): void {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
  frame.onload = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };
  frame.src = url;
  document.body.appendChild(frame);
  ui.onClose(() => frame.remove());
}

function htmlImagen(src: string, titulo: string): string {
  const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(titulo)}</title>` +
    '<style>@page{margin:10mm}html,body{margin:0}img{display:block;max-width:100%;max-height:100vh;margin:0 auto;object-fit:contain}</style>' +
    `</head><body><img src="${esc(src)}"></body></html>`;
}

/** Muestra el PDF (jsPDF) en un visor embebido con soporte de interactividad y controles extra. */
export function previewPdf(doc: JsPDFType | { output: (type: string) => unknown; save: (name: string) => void }, filename: string, opciones?: PreviewPdfOpciones): void {
  let currentDoc: any = doc;
  let currentBlob = currentDoc.output('blob') as Blob;
  let currentUrl = URL.createObjectURL(currentBlob);
  const ui = buildOverlay(filename);

  const renderPdf = (_docARenderizar: any, urlARenderizar: string) => {
    ui.body.innerHTML = '';
    const iframe = document.createElement('iframe');
    iframe.src = urlARenderizar;
    iframe.title = filename;
    iframe.style.cssText = 'width:100%;height:100%;border:0;background:#fff;';
    ui.body.appendChild(iframe);
  };

  renderPdf(currentDoc, currentUrl);

  const updatePdf = (nuevoDoc: any) => {
    URL.revokeObjectURL(currentUrl);
    currentDoc = nuevoDoc;
    currentBlob = currentDoc.output('blob');
    currentUrl = URL.createObjectURL(currentBlob);
    renderPdf(currentDoc, currentUrl);
  };

  if (opciones?.extraControls) {
    opciones.extraControls({ bar: ui.bar, updatePdf, close: ui.close });
  }

  ui.btnDl.onclick = () => currentDoc.save(filename);
  ui.btnPrint.onclick = () => imprimirUrlLocal(currentUrl, ui);
  ui.onClose(() => URL.revokeObjectURL(currentUrl));
}

/** Vista previa de un archivo ya subido (factura, comprobante, etc.) desde su URL firmada. */
export function previewArchivo(url: string, filename = 'archivo'): void {
  const ui = buildOverlay(filename);
  const esImagen = /\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i.test(url) || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(filename);
  
  if (esImagen) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;padding:1rem;overflow:auto;';
    const img = document.createElement('img');
    img.src = url;
    img.alt = filename;
    img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;background:#fff;';
    wrap.appendChild(img);
    ui.body.appendChild(wrap);
  } else {
    const iframe = document.createElement('iframe');
    iframe.src = url;
    iframe.title = filename;
    iframe.style.cssText = 'width:100%;height:100%;border:0;background:#fff;';
    ui.body.appendChild(iframe);
  }

  const btnTab = document.createElement('a');
  btnTab.textContent = '↗ Abrir en pestaña';
  btnTab.href = url;
  btnTab.target = '_blank';
  btnTab.rel = 'noopener noreferrer';
  btnTab.style.cssText = 'text-decoration:none;background:transparent;color:#e6edf3;border:1px solid #30363d;border-radius:6px;padding:.5rem .9rem;font:600 .9rem system-ui;cursor:pointer;';
  ui.btnDl.insertAdjacentElement('beforebegin', btnTab);

  ui.btnPrint.onclick = async () => {
    const texto = ui.btnPrint.textContent;
    ui.btnPrint.disabled = true;
    ui.btnPrint.textContent = '🖨 Preparando…';
    try {
      const bajado = await (await fetch(url)).blob();
      const imagen = esImagen || bajado.type.startsWith('image/');
      const blob = imagen || bajado.type === 'application/pdf' ? bajado : new Blob([bajado], { type: 'application/pdf' });
      const blobUrl = URL.createObjectURL(blob);
      ui.onClose(() => URL.revokeObjectURL(blobUrl));
      if (imagen) {
        const pagina = URL.createObjectURL(new Blob([htmlImagen(blobUrl, filename)], { type: 'text/html' }));
        ui.onClose(() => URL.revokeObjectURL(pagina));
        imprimirUrlLocal(pagina, ui);
      } else {
        imprimirUrlLocal(blobUrl, ui);
      }
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer');
    } finally {
      ui.btnPrint.disabled = false;
      ui.btnPrint.textContent = texto;
    }
  };

  ui.btnDl.onclick = async () => {
    try {
      const resp = await fetch(url);
      const blob = await resp.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objUrl), 4000);
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };
}

/** Previsualiza un archivo Excel ya armado en ArrayBuffer. */
export async function previewExcelArchivo(bytes: ArrayBuffer, filename: string): Promise<void> {
  const XLSX = await import('xlsx-js-style');
  const wb = XLSX.read(bytes, { type: 'array' });
  await previewExcel(wb, filename, () => {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  });
}

/** Muestra una vista previa (primera hoja como tabla) del Excel. */
export async function previewExcel(wbInput: WorkBook | unknown, filename: string, descargar?: () => void): Promise<void> {
  const wb = wbInput as WorkBook;
  const XLSX = await import('xlsx-js-style');
  const ui = buildOverlay(filename);
  const wrap = document.createElement('div');
  wrap.style.cssText = 'padding:1rem;background:#fff;color:#111;overflow:auto;';
  const primera = wb.SheetNames[0];
  const otras = wb.SheetNames.length > 1 ? ` (+${wb.SheetNames.length - 1} hoja(s) más en el archivo)` : '';
  const html = primera ? XLSX.utils.sheet_to_html(wb.Sheets[primera]) : '<p>(vacío)</p>';
  wrap.innerHTML =
    `<div style="font:600 .9rem system-ui;margin-bottom:.6rem;color:#444">Hoja: ${primera ?? '—'}${otras}</div>` + html;
  wrap.querySelectorAll('table').forEach((t) => {
    (t as HTMLTableElement).style.cssText = 'border-collapse:collapse;font:.82rem system-ui;width:100%;';
    t.querySelectorAll('td,th').forEach((c) => {
      (c as HTMLElement).style.cssText = 'border:1px solid #ccc;padding:.25rem .5rem;';
    });
  });
  ui.body.appendChild(wrap);
  ui.btnDl.onclick = descargar ?? (() => XLSX.writeFile(wb, filename));
}
