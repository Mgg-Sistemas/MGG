/* ============================================================
   MGG · Vista previa de reportes (PDF / Excel)
   Regla del sistema: nada se descarga solo. Todo reporte se MUESTRA
   primero en una vista previa y solo se descarga si el usuario toca
   "Descargar".

   - PDF: se parchea `jsPDF.prototype.save` para que, en vez de bajar el
     archivo, abra un visor con el PDF embebido (iframe) + botón Descargar.
     Así TODOS los reportes PDF quedan cubiertos sin tocar cada generador.
   - Excel: `previewWorkbook(XLSX, wb, filename)` muestra la primera hoja como
     tabla (vista previa real) + botón Descargar. Reemplaza a `XLSX.writeFile`.
   ============================================================ */

type AnyXLSX = {
  utils: { sheet_to_html: (ws: unknown) => string };
  write: (wb: unknown, opts: { type: string; bookType: string }) => unknown;
};

/** Construye el overlay imperativo (no depende de React). Devuelve helpers. */
function abrirVisor(opts: {
  titulo: string;
  filename: string;
  /** Contenido del cuerpo: un iframe (PDF) o un div con tabla (Excel). */
  cuerpo: HTMLElement;
  /** Blob a descargar al tocar "Descargar". */
  blob: Blob;
  /** Limpieza extra al cerrar (revocar object URLs, etc.). */
  onClose?: () => void;
  /** Si viene, se muestra el botón «🖨 Imprimir» (manda a la impresora). */
  imprimir?: () => void;
}): void {
  const backdrop = document.createElement('div');
  backdrop.setAttribute('role', 'dialog');
  backdrop.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:9600',
    'background:rgba(3,5,8,0.78)', 'backdrop-filter:blur(4px)',
    'display:flex', 'align-items:center', 'justify-content:center',
  ].join(';');

  const panel = document.createElement('div');
  panel.style.cssText = [
    'background:var(--surface,#11151c)', 'border:1px solid var(--border-strong,#2a3240)',
    'border-radius:12px', 'width:94vw', 'height:94vh',
    'display:flex', 'flex-direction:column', 'overflow:hidden',
    'box-shadow:0 20px 60px rgba(0,0,0,.5)',
  ].join(';');

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.8rem 1.1rem;border-bottom:1px solid var(--border,#222a35);flex:0 0 auto;';
  const titulo = document.createElement('div');
  titulo.style.cssText = 'font-weight:700;color:var(--text,#e7ecf3);';
  titulo.textContent = `${opts.titulo} · vista previa`;
  const fname = document.createElement('div');
  fname.style.cssText = 'font-size:.8rem;color:var(--muted,#8b97a8);margin-left:auto;font-family:monospace;';
  fname.textContent = opts.filename;
  header.appendChild(titulo);
  header.appendChild(fname);

  const body = document.createElement('div');
  body.style.cssText = 'flex:1 1 auto;min-height:0;overflow:auto;background:#525659;';
  body.appendChild(opts.cuerpo);

  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;justify-content:flex-end;gap:.5rem;padding:.7rem 1.1rem;border-top:1px solid var(--border,#222a35);flex:0 0 auto;background:var(--bg-2,#0d1117);';
  const btnCerrar = document.createElement('button');
  btnCerrar.className = 'btn btn-ghost';
  btnCerrar.textContent = 'Cerrar';
  const btnDescargar = document.createElement('button');
  btnDescargar.className = 'btn btn-primary';
  btnDescargar.textContent = '↓ Descargar';
  footer.appendChild(btnCerrar);
  if (opts.imprimir) {
    const btnImprimir = document.createElement('button');
    btnImprimir.className = 'btn';
    btnImprimir.textContent = '🖨 Imprimir';
    btnImprimir.title = 'Enviar a la impresora';
    btnImprimir.addEventListener('click', () => opts.imprimir?.());
    footer.appendChild(btnImprimir);
  }
  footer.appendChild(btnDescargar);

  panel.appendChild(header);
  panel.appendChild(body);
  panel.appendChild(footer);
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);

  const cerrar = () => {
    try { opts.onClose?.(); } catch { /* noop */ }
    backdrop.remove();
  };
  btnCerrar.addEventListener('click', cerrar);
  // No cierra al clic afuera (consistente con el resto de modales): solo botones.
  btnDescargar.addEventListener('click', () => {
    const url = URL.createObjectURL(opts.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = opts.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  });
}

/**
 * Imprime el PDF abriéndolo en SU PROPIA pestaña y pidiendo la impresión ahí.
 *
 * POR QUÉ NO SE IMPRIME EL IFRAME DEL VISOR (07-10-2026)
 * `iframe.contentWindow.print()` imprimía el MARCO del visor, no el PDF: el
 * navegador tomaba la página embebida como una página web, la encogía a ~75 %
 * y la pegaba arriba a la izquierda de la hoja, con el resto en blanco. El
 * archivo descargado se veía bien; solo «🖨 Imprimir» salía descuadrado.
 * En una pestaña propia el visor de PDF del navegador imprime a tamaño real,
 * igual que el archivo descargado.
 *
 * Si el navegador bloquea la pestaña nueva (bloqueador de ventanas) se avisa
 * para que la persona descargue e imprima desde el archivo.
 */
function imprimirPdfEnPestana(url: string): void {
  const w = window.open(url, '_blank');
  if (!w) {
    try { window.alert('El navegador bloqueó la pestaña de impresión. Descargá el PDF y imprimilo desde el archivo.'); } catch { /* sin alert */ }
    return;
  }
  /* NO se llama `w.print()` desde acá (15-10-2026). En Chrome/Edge la pestaña del
     PDF es una página del navegador que EMBEBE el visor; pedirle print() a esa
     página imprimía el marco con el PDF encogido a ~75 % y pegado arriba a la
     izquierda, con el resto de la hoja en blanco (lo reportó la administradora con
     los comprobantes de nómina). El PDF se imprime bien solo cuando lo pide el
     visor mismo: con la orden de impresión EMBEBIDA en el archivo (autoPrint, ver
     `imprimirPdfGenerado`) o con el botón 🖨 del visor / Ctrl+P en la pestaña. */
  try { w.focus(); } catch { /* queda la pestaña abierta */ }
}

/**
 * Imprime un PDF GENERADO por el sistema (jsPDF): le embebe la orden de impresión
 * (`autoPrint` → /OpenAction /Print) y lo abre en su pestaña. El visor del navegador
 * ejecuta esa orden al abrirlo y saca el diálogo de impresión con el PDF a tamaño
 * real y con sus márgenes (los 2 cm del documento). Si el visor no obedece la
 * orden, la pestaña queda abierta y se imprime desde su botón.
 */
function imprimirPdfGenerado(doc: DocPdf, urlVista: string): void {
  let url = urlVista;
  try {
    if (typeof doc.autoPrint === 'function') {
      doc.autoPrint();
      url = URL.createObjectURL(doc.output('blob') as Blob);
      // La pestaña ya tiene el archivo cargado; el object URL se libera después.
      setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
    }
  } catch {
    url = urlVista; // sin autoPrint: se abre la vista y se imprime desde el visor
  }
  imprimirPdfEnPestana(url);
}

type DocPdf = { output: (type: string) => unknown; autoPrint?: () => unknown };

/** Imprime una imagen sola, en una hoja, con un iframe oculto. */
function imprimirImagen(url: string): void {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
  frame.srcdoc = `<!doctype html><html><head><style>@page{margin:10mm}html,body{margin:0;height:100%}body{display:flex;align-items:center;justify-content:center}img{max-width:100%;max-height:100%;object-fit:contain}</style></head><body><img src="${url}"></body></html>`;
  frame.onload = () => {
    const w = frame.contentWindow;
    const img = frame.contentDocument?.querySelector('img');
    const lanzar = () => {
      try { w?.focus(); w?.print(); } catch { window.open(url, '_blank', 'noopener'); }
      setTimeout(() => frame.remove(), 60000);
    };
    if (img && !img.complete) img.onload = lanzar; else lanzar();
  };
  document.body.appendChild(frame);
}

/**
 * ¿Este navegador pinta un PDF DENTRO de la página (en el iframe del visor)?
 *
 * POR QUÉ (02-11-2026). La administradora reportó que en la vista de teléfono
 * de Inventario «no se ve el PDF» de la salida: el botón estaba y el PDF se
 * armaba, pero Chrome de Android no muestra un PDF metido en un iframe (queda
 * el recuadro gris vacío) y el iPhone pinta solo una imagen de la primera hoja.
 * En esos casos el visor ofrece «Abrir el PDF» en su propia pestaña, que el
 * teléfono sí abre con su visor de PDF. Sigue siendo con el botón: nada se baja solo.
 */
export function muestraPdfEnPagina(nav: { pdfViewerEnabled?: boolean; userAgent?: string } | undefined): boolean {
  if (!nav) return true;
  if (nav.pdfViewerEnabled === false) return false;
  return !/Android|iPhone|iPod|Mobi/i.test(nav.userAgent ?? '');
}

/** El cuerpo del visor cuando el PDF no se puede pintar en la página (teléfono). */
function avisoAbrirPdf(url: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem;padding:1.5rem;text-align:center;color:#fff;';
  const icono = document.createElement('div');
  icono.style.cssText = 'font-size:3rem;line-height:1;';
  icono.textContent = '📄';
  const texto = document.createElement('p');
  texto.style.cssText = 'margin:0;max-width:28rem;font-size:1rem;';
  texto.textContent = 'El PDF está listo. Este teléfono no lo muestra dentro de esta ventana: tócalo para abrirlo en el visor de PDF.';
  const abrir = document.createElement('button');
  abrir.className = 'btn btn-primary';
  abrir.style.cssText = 'min-height:56px;font-size:1.15rem;font-weight:800;padding:.6rem 1.4rem;';
  abrir.textContent = '📄 Abrir el PDF';
  abrir.addEventListener('click', () => {
    const w = window.open(url, '_blank');
    if (!w) {
      try { window.alert('El navegador bloqueó la pestaña nueva. Toca «Descargar» y abre el PDF desde la descarga.'); } catch { /* sin alert */ }
    }
  });
  const ayuda = document.createElement('small');
  ayuda.style.cssText = 'opacity:.8;max-width:28rem;';
  ayuda.textContent = 'Si no se abre, toca «↓ Descargar» y ábrelo desde la descarga.';
  wrap.append(icono, texto, abrir, ayuda);
  return wrap;
}

/** Muestra un PDF (jsPDF doc) en el visor. Lo usa el patch de `save`. */
export function previewPdfDoc(doc: DocPdf, filename: string): void {
  const blob = doc.output('blob') as Blob;
  const url = URL.createObjectURL(blob);
  let cuerpo: HTMLElement;
  if (muestraPdfEnPagina(typeof navigator === 'undefined' ? undefined : navigator)) {
    const iframe = document.createElement('iframe');
    iframe.src = url;
    iframe.style.cssText = 'width:100%;height:100%;border:0;display:block;';
    cuerpo = iframe;
  } else {
    cuerpo = avisoAbrirPdf(url);
  }
  abrirVisor({
    titulo: 'PDF', filename, cuerpo, blob,
    onClose: () => URL.revokeObjectURL(url),
    imprimir: () => imprimirPdfGenerado(doc, url),
  });
}

/**
 * IMPRIME un PDF GENERADO por el sistema (jsPDF) sin pasar por el visor: le embebe
 * la orden de impresión y lo abre en su pestaña (mismo camino que el botón 🖨 del
 * visor, ver `imprimirPdfGenerado`). Lo usan los reportes que se piden «imprimir por
 * sistema»: el botón va en la pantalla y el PDF sale a tamaño real con sus márgenes.
 */
export function imprimirPdfDoc(doc: DocPdf): void {
  let url: string;
  try {
    url = URL.createObjectURL(doc.output('blob') as Blob);
  } catch {
    return; // sin blob no hay nada que imprimir
  }
  // La pestaña ya tiene el archivo cargado; el object URL se libera después.
  setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
  imprimirPdfGenerado(doc, url);
}

/** Tipo real por los primeros bytes: PDF o imagen ráster. null = no se muestra (HTML, SVG, otro). */
export async function tipoArchivoSeguro(blob: Blob): Promise<string | null> {
  const b = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const asc = (i: number, n: number) => String.fromCharCode(...b.slice(i, i + n));
  if (asc(0, 5) === '%PDF-') return 'application/pdf';
  if (b[0] === 0x89 && asc(1, 3) === 'PNG') return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (asc(0, 4) === 'GIF8') return 'image/gif';
  if (asc(0, 4) === 'RIFF' && asc(8, 4) === 'WEBP') return 'image/webp';
  if (asc(0, 2) === 'BM') return 'image/bmp';
  return null;
}

function descargarBlob(blob: Blob, filename: string): void {
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = u; a.download = filename || 'archivo'; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 10_000);
}

/**
 * Muestra en el visor un archivo YA SUBIDO (factura/comprobante) desde su URL firmada.
 * Soporta PDF (iframe) e imagen (img). Trae el blob para el botón Descargar; si el
 * fetch falla (CORS/red), cae a abrir en pestaña nueva.
 */
export async function previewFileUrl(url: string, filename: string, titulo = 'Factura'): Promise<void> {
  let blob: Blob;
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('no-ok');
    blob = await resp.blob();
  } catch {
    window.open(url, '_blank', 'noopener');
    return;
  }
  // Solo se MUESTRA lo que de verdad es PDF o imagen ráster (por sus primeros bytes, no por
  // el nombre ni el tipo que diga el archivo): un HTML/SVG subido como «comprobante» se
  // ejecutaría en el origen del sistema. Lo demás se descarga, nunca se renderiza (12-11-2026).
  const tipoReal = await tipoArchivoSeguro(blob);
  if (!tipoReal) {
    descargarBlob(new Blob([blob], { type: 'application/octet-stream' }), filename);
    return;
  }
  blob = new Blob([blob], { type: tipoReal });
  const objUrl = URL.createObjectURL(blob);
  const esImagen = tipoReal.startsWith('image/');
  let cuerpo: HTMLElement;
  let imprimir: () => void;
  if (esImagen) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;padding:1rem;';
    const img = document.createElement('img');
    img.src = objUrl;
    img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;display:block;';
    wrap.appendChild(img);
    cuerpo = wrap;
    imprimir = () => imprimirImagen(objUrl);
  } else {
    const iframe = document.createElement('iframe');
    iframe.src = objUrl;
    iframe.style.cssText = 'width:100%;height:100%;border:0;display:block;';
    cuerpo = iframe;
    imprimir = () => imprimirPdfEnPestana(objUrl);
  }
  abrirVisor({ titulo, filename, cuerpo, blob, imprimir, onClose: () => URL.revokeObjectURL(objUrl) });
}

/** Muestra un workbook de Excel: hojas como tabla + botón Descargar.
 *  `xlsxMod` es el módulo `xlsx-js-style` (se acepta sin tipar para tolerar los
 *  casts locales de cada generador). */
export function previewWorkbook(xlsxMod: unknown, workbook: unknown, filename: string): void {
  const XLSX = xlsxMod as AnyXLSX;
  const wb = workbook as { SheetNames: string[]; Sheets: Record<string, unknown> };
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const cont = document.createElement('div');
  cont.style.cssText = 'background:#fff;color:#111;padding:1rem;min-height:100%;overflow:auto;';
  const sheets = wb.SheetNames.map((name) => {
    const html = XLSX.utils.sheet_to_html(wb.Sheets[name]);
    return `<h3 style="font-family:sans-serif;margin:.6rem 0 .3rem;font-size:.95rem;">${name}</h3>${html}`;
  }).join('');
  cont.innerHTML = `<style>
    .mgg-xlsx-prev table{border-collapse:collapse;font-family:sans-serif;font-size:.78rem;margin-bottom:1rem;}
    .mgg-xlsx-prev td,.mgg-xlsx-prev th{border:1px solid #ccc;padding:3px 7px;white-space:nowrap;}
    .mgg-xlsx-prev tr:first-child td{background:#f3f4f6;font-weight:600;}
  </style><div class="mgg-xlsx-prev">${sheets}</div>`;
  abrirVisor({ titulo: 'Excel', filename, cuerpo: cont, blob });
}

/** Parchea `jsPDF.prototype.save` para que muestre la vista previa en vez de
 *  descargar. Idempotente: se llama una vez al arrancar la app. */
export async function instalarPreviewPdf(): Promise<void> {
  try {
    const mod = await import('jspdf');
    const proto = mod.jsPDF.prototype as unknown as { save: (f?: string) => unknown; __mggPreview?: boolean };
    if (proto.__mggPreview) return;
    proto.__mggPreview = true;
    proto.save = function (filename?: string) {
      previewPdfDoc(this as unknown as { output: (t: string) => unknown }, filename || 'reporte.pdf');
      return this;
    };
  } catch {
    /* si jspdf no carga, los reportes seguirán bajando normalmente */
  }
}
