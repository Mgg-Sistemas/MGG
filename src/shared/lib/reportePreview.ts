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
  setTitle: (nuevo: string) => void;
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
  const setTitle = (nuevo: string) => { title.textContent = `Vista previa · ${nuevo}`; };

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

  return { bar, body, btnDl, btnPrint, setTitle, close, onClose: (fn: () => void) => closers.push(fn) };
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

export interface PreviewImagenItem {
  url: string;
  filename: string;
  /** Contexto opcional para la barra superior, p. ej. «OC-2026-0200 · Al recibir del proveedor». */
  etiqueta?: string;
}

const ESCALAS_IMAGEN = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];
const ESTILO_BTN_BARRA =
  'background:transparent;color:#e6edf3;border:1px solid #30363d;border-radius:6px;padding:.45rem .7rem;font:600 .88rem system-ui;cursor:pointer;';

async function rotarBlobImagen(blobUrl: string, giro: number): Promise<string | null> {
  if (!giro) return null;
  return await new Promise<string | null>((resolve) => {
    const im = new Image();
    im.onload = () => {
      try {
        const girada = giro === 90 || giro === 270;
        const canvas = document.createElement('canvas');
        canvas.width = girada ? im.naturalHeight : im.naturalWidth;
        canvas.height = girada ? im.naturalWidth : im.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(null); return; }
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((giro * Math.PI) / 180);
        ctx.drawImage(im, -im.naturalWidth / 2, -im.naturalHeight / 2);
        canvas.toBlob((b) => resolve(b ? URL.createObjectURL(b) : null), 'image/jpeg', 0.92);
      } catch {
        resolve(null);
      }
    };
    im.onerror = () => resolve(null);
    im.src = blobUrl;
  });
}

/**
 * Vista previa de una o varias IMÁGENES dentro del sistema (mismo formato `Vista previa`
 * de los reportes: barra superior con zoom, rotación, navegación entre fotos, 🖨 Imprimir,
 * ⬇ Descargar, ↗ Abrir en pestaña y ✕ Cerrar).
 */
export function previewGaleria(items: PreviewImagenItem[], indiceInicial = 0): void {
  const validos = items.filter((x) => !!x.url);
  if (!validos.length) return;
  let idx = Math.min(Math.max(0, indiceInicial), validos.length - 1);
  let escala = 1;
  let giro = 0;
  let natural: { w: number; h: number } | null = null;

  const tituloDe = (i: number) => {
    const it = validos[i];
    const num = validos.length > 1 ? ` (${i + 1}/${validos.length})` : '';
    return it.etiqueta ? `${it.etiqueta}${num} · ${it.filename}` : `${it.filename}${num}`;
  };

  const ui = buildOverlay(tituloDe(idx));

  // Controles de navegación (solo si hay más de una foto)
  const btnPrev = document.createElement('button');
  btnPrev.type = 'button'; btnPrev.textContent = '‹'; btnPrev.title = 'Foto anterior (←)';
  btnPrev.style.cssText = ESTILO_BTN_BARRA;
  const lblPos = document.createElement('span');
  lblPos.style.cssText = 'color:#9da7b3;font:600 .85rem system-ui;min-width:2.8rem;text-align:center;';
  const btnNext = document.createElement('button');
  btnNext.type = 'button'; btnNext.textContent = '›'; btnNext.title = 'Foto siguiente (→)';
  btnNext.style.cssText = ESTILO_BTN_BARRA;

  // Controles de zoom y rotación (muy útiles para facturas / notas de entrega)
  const btnMenos = document.createElement('button');
  btnMenos.type = 'button'; btnMenos.textContent = '−'; btnMenos.title = 'Alejar';
  btnMenos.style.cssText = ESTILO_BTN_BARRA;
  const btnZoom = document.createElement('button');
  btnZoom.type = 'button'; btnZoom.textContent = '100%'; btnZoom.title = 'Restablecer zoom y rotación';
  btnZoom.style.cssText = `${ESTILO_BTN_BARRA}min-width:3.8rem;`;
  const btnMas = document.createElement('button');
  btnMas.type = 'button'; btnMas.textContent = '+'; btnMas.title = 'Acercar';
  btnMas.style.cssText = ESTILO_BTN_BARRA;
  const btnGiro = document.createElement('button');
  btnGiro.type = 'button'; btnGiro.textContent = '⟳'; btnGiro.title = 'Rotar 90°';
  btnGiro.style.cssText = ESTILO_BTN_BARRA;

  const btnTab = document.createElement('a');
  btnTab.textContent = '↗ Abrir en pestaña';
  btnTab.target = '_blank'; btnTab.rel = 'noopener noreferrer';
  btnTab.style.cssText = `text-decoration:none;${ESTILO_BTN_BARRA}`;

  const anchor = ui.btnPrint;
  if (validos.length > 1) {
    anchor.insertAdjacentElement('beforebegin', btnPrev);
    anchor.insertAdjacentElement('beforebegin', lblPos);
    anchor.insertAdjacentElement('beforebegin', btnNext);
  }
  anchor.insertAdjacentElement('beforebegin', btnMenos);
  anchor.insertAdjacentElement('beforebegin', btnZoom);
  anchor.insertAdjacentElement('beforebegin', btnMas);
  anchor.insertAdjacentElement('beforebegin', btnGiro);
  ui.btnDl.insertAdjacentElement('beforebegin', btnTab);
  ui.btnPrint.style.display = '';

  const stage = document.createElement('div');
  stage.style.cssText = 'min-width:100%;min-height:100%;display:flex;padding:16px;box-sizing:border-box;';
  const caja = document.createElement('div');
  caja.style.cssText = 'margin:auto;position:relative;flex:0 0 auto;';
  const img = document.createElement('img');
  img.style.cssText = 'display:block;background:#fff;border-radius:4px;box-shadow:0 8px 32px rgba(0,0,0,.45);transition:transform .15s ease;';
  caja.appendChild(img);
  stage.appendChild(caja);
  ui.body.appendChild(stage);

  const aplicarMedidas = () => {
    btnZoom.textContent = `${Math.round(escala * 100)}%`;
    if (!natural) {
      caja.style.width = '';
      caja.style.height = '';
      img.style.cssText = 'max-width:calc(100vw - 32px);max-height:calc(100vh - 96px);object-fit:contain;display:block;background:#fff;border-radius:4px;';
      return;
    }
    const availW = Math.max(200, (ui.body.clientWidth || window.innerWidth) - 32);
    const availH = Math.max(200, (ui.body.clientHeight || window.innerHeight - 64) - 32);
    const girada = giro === 90 || giro === 270;
    const vw = girada ? natural.h : natural.w;
    const vh = girada ? natural.w : natural.h;
    const fit = Math.min(availW / Math.max(vw, 1), availH / Math.max(vh, 1), 1);
    const imgW = Math.max(1, Math.round(natural.w * fit * escala));
    const imgH = Math.max(1, Math.round(natural.h * fit * escala));
    const cajaW = girada ? imgH : imgW;
    const cajaH = girada ? imgW : imgH;
    caja.style.width = `${cajaW}px`;
    caja.style.height = `${cajaH}px`;
    img.style.cssText =
      `position:absolute;left:50%;top:50%;width:${imgW}px;height:${imgH}px;max-width:none;max-height:none;` +
      `transform:translate(-50%,-50%) rotate(${giro}deg);transition:transform .15s ease;background:#fff;border-radius:4px;box-shadow:0 8px 32px rgba(0,0,0,.45);`;
  };

  const mostrar = (nuevoIdx: number) => {
    idx = (nuevoIdx + validos.length) % validos.length;
    escala = 1;
    giro = 0;
    natural = null;
    const it = validos[idx];
    ui.setTitle(tituloDe(idx));
    lblPos.textContent = `${idx + 1} / ${validos.length}`;
    btnTab.href = it.url;
    img.alt = it.filename;
    aplicarMedidas();
    img.src = it.url;
  };

  img.onload = () => {
    natural = { w: img.naturalWidth || 800, h: img.naturalHeight || 600 };
    aplicarMedidas();
  };

  const cambiarEscala = (dir: -1 | 1) => {
    const pos = ESCALAS_IMAGEN.findIndex((x) => x >= escala - 0.001);
    const actual = pos === -1 ? ESCALAS_IMAGEN.length - 1 : pos;
    const sig = Math.min(Math.max(0, actual + dir), ESCALAS_IMAGEN.length - 1);
    escala = ESCALAS_IMAGEN[sig];
    aplicarMedidas();
  };

  btnPrev.onclick = () => mostrar(idx - 1);
  btnNext.onclick = () => mostrar(idx + 1);
  btnMenos.onclick = () => cambiarEscala(-1);
  btnMas.onclick = () => cambiarEscala(1);
  btnZoom.onclick = () => { escala = 1; giro = 0; aplicarMedidas(); };
  btnGiro.onclick = () => { giro = (giro + 90) % 360; aplicarMedidas(); };

  const onNavKey = (e: KeyboardEvent) => {
    if (validos.length > 1 && e.key === 'ArrowLeft') { e.preventDefault(); mostrar(idx - 1); }
    else if (validos.length > 1 && e.key === 'ArrowRight') { e.preventDefault(); mostrar(idx + 1); }
  };
  document.addEventListener('keydown', onNavKey);
  ui.onClose(() => document.removeEventListener('keydown', onNavKey));

  const onResize = () => aplicarMedidas();
  window.addEventListener('resize', onResize);
  ui.onClose(() => window.removeEventListener('resize', onResize));

  ui.btnPrint.onclick = async () => {
    const it = validos[idx];
    const texto = ui.btnPrint.textContent;
    ui.btnPrint.disabled = true;
    ui.btnPrint.textContent = '🖨 Preparando…';
    try {
      const bajado = await (await fetch(it.url)).blob();
      const blobUrl = URL.createObjectURL(bajado);
      ui.onClose(() => URL.revokeObjectURL(blobUrl));
      const rotadaUrl = await rotarBlobImagen(blobUrl, giro);
      if (rotadaUrl) ui.onClose(() => URL.revokeObjectURL(rotadaUrl));
      const pagina = URL.createObjectURL(new Blob([htmlImagen(rotadaUrl ?? blobUrl, it.filename)], { type: 'text/html' }));
      ui.onClose(() => URL.revokeObjectURL(pagina));
      imprimirUrlLocal(pagina, ui);
    } catch {
      window.open(it.url, '_blank', 'noopener,noreferrer');
    } finally {
      ui.btnPrint.disabled = false;
      ui.btnPrint.textContent = texto;
    }
  };

  ui.btnDl.onclick = async () => {
    const it = validos[idx];
    try {
      const resp = await fetch(it.url);
      const blob = await resp.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl; a.download = it.filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(objUrl), 4000);
    } catch {
      window.open(it.url, '_blank', 'noopener,noreferrer');
    }
  };

  mostrar(idx);
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
