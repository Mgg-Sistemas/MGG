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

/** Muestra un PDF (jsPDF doc) en el visor. Lo usa el patch de `save`. */
export function previewPdfDoc(doc: { output: (type: string) => unknown }, filename: string): void {
  const blob = doc.output('blob') as Blob;
  const url = URL.createObjectURL(blob);
  const iframe = document.createElement('iframe');
  iframe.src = url;
  iframe.style.cssText = 'width:100%;height:100%;border:0;display:block;';
  abrirVisor({
    titulo: 'PDF', filename, cuerpo: iframe, blob,
    onClose: () => URL.revokeObjectURL(url),
  });
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
  const objUrl = URL.createObjectURL(blob);
  const esImagen = blob.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(filename);
  let cuerpo: HTMLElement;
  if (esImagen) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;padding:1rem;';
    const img = document.createElement('img');
    img.src = objUrl;
    img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;display:block;';
    wrap.appendChild(img);
    cuerpo = wrap;
  } else {
    const iframe = document.createElement('iframe');
    iframe.src = objUrl;
    iframe.style.cssText = 'width:100%;height:100%;border:0;display:block;';
    cuerpo = iframe;
  }
  abrirVisor({ titulo, filename, cuerpo, blob, onClose: () => URL.revokeObjectURL(objUrl) });
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
