/* ============================================================
   MGG · RRHH · Carnet de identificación (imagen PNG)
   Genera un carnet vertical de 54×86 mm a 300 DPI (638×1016 px)
   con el logo de MGG, nombre/apellido, cédula y un QR con los
   datos de la persona (cédula, teléfono y contacto de emergencia).
   Colores del sistema (dark + naranja/dorado). Todo se dibuja en
   un <canvas>, así que no depende de estilos ni fuentes web.
   ============================================================ */
import qrcode from 'qrcode-generator';
import { loadLogoDataUrl } from '@/shared/lib/pdfLogo';
import type { Personal } from '@/shared/lib/types';

// 54 × 86 mm a 300 DPI. 1 mm = 300 / 25.4 px.
const DPI = 300;
const MM = DPI / 25.4;
const W = Math.round(54 * MM); // 638
const H = Math.round(86 * MM); // 1016

// Paleta (idéntica a theme.css).
const C = {
  bgTop: '#0d1014',
  bgBottom: '#161c25',
  primary: '#ff8a00',
  gold: '#ffd54a',
  primary3: '#ffd07a',
  text: '#e7ecf3',
  muted: '#9aa6b5',
  dim: '#6a7585',
  border: '#2f3a4a',
  white: '#ffffff',
  dark: '#0d1014',
};

const FONT = 'Arial, "Segoe UI", Helvetica, sans-serif';

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function loadImage(src: string, crossOrigin?: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = crossOrigin;
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
    img.src = src;
  });
}

/** Iniciales (nombre + apellido) para el marco cuando no hay foto. */
function iniciales(p: Personal): string {
  const a = (p.nombre ?? '').trim()[0] ?? '';
  const b = (p.apellido ?? '').trim()[0] ?? '';
  return (a + b).toUpperCase() || '·';
}

/** Dibuja la foto (cover, recortada al marco) o, si no hay, las iniciales. */
async function dibujarFoto(ctx: CanvasRenderingContext2D, p: Personal, x: number, y: number, w: number, h: number) {
  const r = 20;
  let img: HTMLImageElement | null = null;
  if (p.foto_url) {
    try { img = await loadImage(p.foto_url, 'anonymous'); } catch { img = null; }
  }
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  if (img) {
    // Cover con encuadre del usuario: llena el marco (proporción) y aplica su zoom y
    // posición. pos 0..1 (0,5 = centrado) reparte el sobrante recortado; zoom ≥1 acerca.
    const zoom = Math.min(4, Math.max(1, Number(p.foto_zoom) || 1));
    const posX = Math.min(1, Math.max(0, p.foto_pos_x == null ? 0.5 : Number(p.foto_pos_x)));
    const posY = Math.min(1, Math.max(0, p.foto_pos_y == null ? 0.5 : Number(p.foto_pos_y)));
    const scale = Math.max(w / img.width, h / img.height) * zoom;
    const dw = img.width * scale;
    const dh = img.height * scale;
    // drawX = x − sobranteHorizontal × posX (posX 0 = pega a la izquierda, 1 = a la derecha).
    ctx.drawImage(img, x - (dw - w) * posX, y - (dh - h) * posY, dw, dh);
  } else {
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, C.bgBottom);
    g.addColorStop(1, C.bgTop);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = C.primary3;
    ctx.font = `800 110px ${FONT}`;
    ctx.fillText(iniciales(p), x + w / 2, y + h / 2);
  }
  ctx.restore();
  // Marco dorado.
  ctx.lineWidth = 4;
  ctx.strokeStyle = C.primary;
  roundRect(ctx, x, y, w, h, r);
  ctx.stroke();
}

/** Parte "NOMBRE APELLIDO" en varias líneas que quepan en maxW. */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Dibuja texto centrado con espaciado entre letras (para los títulos). */
function tracked(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, spacing: number) {
  const chars = [...text];
  let total = 0;
  for (const ch of chars) total += ctx.measureText(ch).width + spacing;
  total -= spacing;
  let x = cx - total / 2;
  for (const ch of chars) {
    const w = ctx.measureText(ch).width;
    ctx.fillText(ch, x + w / 2, y);
    x += w + spacing;
  }
}

/** Contenido legible del QR (lo que se ve al escanear). */
function textoQR(p: Personal): string {
  const nombre = `${p.nombre ?? ''} ${p.apellido ?? ''}`.trim();
  const emerg = [p.contacto_emergencia, p.contacto_emergencia_tlf].filter(Boolean).join(' · ');
  return [
    'MGG · CARNET',
    `Nombre: ${nombre}`,
    p.cedula ? `Cédula: ${p.cedula}` : '',
    p.cargo ? `Cargo: ${p.cargo}` : '',
    p.departamento ? `Departamento: ${p.departamento}` : '',
    p.telefono ? `Teléfono: ${p.telefono}` : '',
    emerg ? `Emergencia: ${emerg}` : '',
  ].filter(Boolean).join('\n');
}

/** Dibuja el QR (módulos nítidos) centrado en un panel blanco. */
function dibujarQR(ctx: CanvasRenderingContext2D, data: string, panelX: number, panelY: number, panel: number) {
  const qr = qrcode(0, 'M');
  // UTF-8: cada carácter multibyte se convierte en bytes 0-255 para que los
  // lectores modernos muestren bien acentos y ñ.
  qr.addData(unescape(encodeURIComponent(data)), 'Byte');
  qr.make();
  const count = qr.getModuleCount();
  const quiet = 4; // zona de silencio (módulos) recomendada por el estándar
  const cell = Math.floor(panel / (count + quiet * 2));
  const qrSize = cell * (count + quiet * 2);
  const ox = panelX + Math.round((panel - qrSize) / 2);
  const oy = panelY + Math.round((panel - qrSize) / 2);
  ctx.fillStyle = C.dark;
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) {
        ctx.fillRect(ox + (c + quiet) * cell, oy + (r + quiet) * cell, cell, cell);
      }
    }
  }
}

/* ─── PNG con densidad física real (chunk pHYs = 300 DPI) ─── */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new Uint8Array([...type].map((ch) => ch.charCodeAt(0)));
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);
  const out = new Uint8Array(4 + body.length + 4);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(body, 4);
  dv.setUint32(4 + body.length, crc32(body));
  return out;
}
/** Inserta un chunk pHYs (DPI físico) justo después del IHDR del PNG. */
async function pngConDpi(blob: Blob, dpi: number): Promise<Blob> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  // Firma PNG (8 bytes) + IHDR (4 long + 4 "IHDR" + 13 datos + 4 CRC = 25) → 33.
  const insertAt = 33;
  const ppu = Math.round(dpi / 0.0254); // píxeles por metro
  const data = new Uint8Array(9);
  const dv = new DataView(data.buffer);
  dv.setUint32(0, ppu);
  dv.setUint32(4, ppu);
  data[8] = 1; // unidad = metro
  const chunk = pngChunk('pHYs', data);
  const out = new Uint8Array(buf.length + chunk.length);
  out.set(buf.subarray(0, insertAt), 0);
  out.set(chunk, insertAt);
  out.set(buf.subarray(insertAt), insertAt + chunk.length);
  return new Blob([out], { type: 'image/png' });
}

// Texto legal del reverso (según lo indicado por la empresa).
const REV_P1 = 'Credencial de uso exclusivo para las alianzas en minerales estratégicos suscritas en la República Bolivariana de Venezuela. Agradecemos a todas las autoridades civiles, militares e institucionales prestar la mayor colaboración posible al portador de esta identificación.';
const REV_P2 = 'La persona portadora de esta credencial pertenece al grupo de alianza de minerales estratégicos de la Corporación Venezolana de Minería.';
const REV_EMAIL = 'mineralgroupguayanaca@gmail.com';
const REV_WHATSAPP = 'WhatsApp +58 424-9349731';

/** Lienzo base con fondo, marco y barra de acento. Devuelve ctx + degradado de acento. */
function nuevoLienzo(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; accent: CanvasGradient } {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('El navegador no soporta canvas 2D.');
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';

  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, C.bgTop);
  grad.addColorStop(1, C.bgBottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  ctx.lineWidth = 3;
  ctx.strokeStyle = C.border;
  roundRect(ctx, 16, 16, W - 32, H - 32, 34);
  ctx.stroke();

  const accent = ctx.createLinearGradient(0, 0, W, 0);
  accent.addColorStop(0, C.primary);
  accent.addColorStop(1, C.gold);
  ctx.fillStyle = accent;
  roundRect(ctx, 16, 16, W - 32, 20, 10);
  ctx.fill();
  return { canvas, ctx, accent };
}

/** Dibuja el logo en un recuadro blanco (redondeado o, si `circular`, en círculo). */
async function dibujarLogo(ctx: CanvasRenderingContext2D, x: number, y: number, box: number, circular = false) {
  const cx = x + box / 2;
  const cy = y + box / 2;
  ctx.save();
  ctx.fillStyle = C.white;
  if (circular) {
    ctx.beginPath();
    ctx.arc(cx, cy, box / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.clip(); // el logo (fondo blanco) queda recortado dentro del círculo
  } else {
    roundRect(ctx, x, y, box, box, box * 0.16);
    ctx.fill();
  }
  try {
    const logo = await loadImage(await loadLogoDataUrl());
    const pad = box * 0.12;
    const maxW = box - pad * 2;
    const maxH = box - pad * 2;
    const scale = Math.min(maxW / logo.width, maxH / logo.height);
    const dw = logo.width * scale;
    const dh = logo.height * scale;
    ctx.drawImage(logo, cx - dw / 2, cy - dh / 2, dw, dh);
  } catch { /* si el logo falta, el carnet igual se genera */ }
  ctx.restore();
  if (circular) {
    // Aro dorado alrededor del círculo.
    ctx.lineWidth = 3;
    ctx.strokeStyle = C.primary;
    ctx.beginPath();
    ctx.arc(cx, cy, box / 2, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function lienzoAPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo generar la imagen'))), 'image/png');
  }).then((b) => pngConDpi(b, DPI));
}

/** Genera el FRENTE del carnet (638×1016 px · 54×86 mm @ 300 DPI). */
export async function generarFrenteBlob(p: Personal): Promise<Blob> {
  const { canvas, ctx, accent } = nuevoLienzo();
  const cx = W / 2;

  // Encabezado: logo + marca (alineado a la izquierda).
  const logoBox = 92;
  await dibujarLogo(ctx, 44, 46, logoBox);
  ctx.textAlign = 'left';
  ctx.fillStyle = C.gold;
  ctx.font = `800 25px ${FONT}`;
  ctx.fillText('MINERAL GROUP', 152, 78);
  ctx.fillText('GUAYANA C.A.', 152, 108);
  ctx.fillStyle = C.muted;
  ctx.font = `600 14px ${FONT}`;
  ctx.fillText('CARNET DE IDENTIFICACIÓN', 152, 132);
  ctx.textAlign = 'center';

  // Divisor de acento.
  ctx.fillStyle = accent;
  roundRect(ctx, 44, 158, W - 88, 3, 2);
  ctx.fill();

  // Foto (o iniciales) en marco dorado.
  const fotoW = 260;
  const fotoH = 300;
  const fotoY = 180;
  await dibujarFoto(ctx, p, cx - fotoW / 2, fotoY, fotoW, fotoH);
  const fotoBottom = fotoY + fotoH;

  // Nombre completo (grande, hasta 2 líneas).
  const nombreFull = `${p.nombre ?? ''} ${p.apellido ?? ''}`.trim().toUpperCase() || '—';
  let fontSize = 44;
  ctx.font = `800 ${fontSize}px ${FONT}`;
  let lines = wrapText(ctx, nombreFull, W - 90);
  while (lines.length > 2 && fontSize > 28) {
    fontSize -= 3;
    ctx.font = `800 ${fontSize}px ${FONT}`;
    lines = wrapText(ctx, nombreFull, W - 90);
  }
  ctx.fillStyle = C.text;
  let ny = fotoBottom + 52;
  for (const ln of lines.slice(0, 2)) { ctx.fillText(ln, cx, ny); ny += fontSize + 6; }

  // Chip de cédula.
  const chipY = ny + 6;
  ctx.font = `700 25px ${FONT}`;
  const ced = p.cedula ? `C.I. ${p.cedula}` : 'C.I. —';
  const chipW = Math.min(ctx.measureText(ced).width + 52, W - 90);
  ctx.fillStyle = 'rgba(255,138,0,0.16)';
  roundRect(ctx, cx - chipW / 2, chipY, chipW, 48, 24);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,138,0,0.55)';
  ctx.lineWidth = 2;
  roundRect(ctx, cx - chipW / 2, chipY, chipW, 48, 24);
  ctx.stroke();
  ctx.fillStyle = C.primary3;
  ctx.fillText(ced, cx, chipY + 25);

  // Cargo · Departamento (una línea).
  const sub = [p.cargo, p.departamento].filter(Boolean).join('  ·  ').toUpperCase();
  if (sub) {
    ctx.fillStyle = C.muted;
    ctx.font = `600 17px ${FONT}`;
    ctx.fillText(wrapText(ctx, sub, W - 110)[0], cx, chipY + 76);
  }

  // Panel blanco con el QR (abajo).
  const panel = 210;
  const panelX = cx - panel / 2;
  const panelY = H - panel - 84;
  ctx.fillStyle = C.white;
  roundRect(ctx, panelX, panelY, panel, panel, 20);
  ctx.fill();
  dibujarQR(ctx, textoQR(p), panelX, panelY, panel);

  ctx.fillStyle = C.dim;
  ctx.font = `600 14px ${FONT}`;
  tracked(ctx, 'ESCANEÁ EL QR PARA VER LOS DATOS', cx, panelY + panel + 24, 1.5);
  ctx.fillStyle = accent;
  roundRect(ctx, 16, H - 36, W - 32, 20, 10);
  ctx.fill();

  return lienzoAPng(canvas);
}

/** Carga el logo de la Corporación Venezolana de Minería (public/cvm.*).
 *  Prueba varias extensiones y mayúsc/minúsc (el servidor Linux distingue may/min). */
async function cargarLogoCVM(): Promise<HTMLImageElement | null> {
  const base = import.meta.env.BASE_URL;
  const candidatos = ['cvm.jpg', 'cvm.jpeg', 'cvm.png', 'cvm.webp', 'CVM.jpg', 'CVM.jpeg', 'CVM.png', 'CVM.webp'];
  for (const nombre of candidatos) {
    try {
      const img = await loadImage(`${base}${nombre}`);
      if (img.width > 1) return img; // en dev, un 404 devuelve el index.html (no decodifica): se ignora
    } catch { /* probamos el siguiente */ }
  }
  return null;
}

/** Dibuja una imagen recortada en círculo (cover), con aro dorado opcional. */
function dibujarCirculo(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, box: number, aro = true) {
  const cx = x + box / 2;
  const cy = y + box / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, box / 2, 0, Math.PI * 2);
  ctx.clip();
  const scale = Math.max(box / img.width, box / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
  ctx.restore();
  if (aro) {
    ctx.lineWidth = 3;
    ctx.strokeStyle = C.primary;
    ctx.beginPath();
    ctx.arc(cx, cy, box / 2, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/** Dibuja un párrafo con ajuste de línea; devuelve la Y donde termina. */
function parrafo(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number): number {
  const lines = wrapText(ctx, text, maxW);
  let yy = y;
  for (const ln of lines) { ctx.fillText(ln, x, yy); yy += lineH; }
  return yy;
}

/** Genera el REVERSO del carnet (texto legal + imagen institucional + contacto). */
export async function generarReversoBlob(): Promise<Blob> {
  const { canvas, ctx, accent } = nuevoLienzo();
  const cx = W / 2;

  // Encabezado: logo de la Corporación Venezolana de Minería (redondo, prominente).
  const cvm = await cargarLogoCVM();
  const logoBox = 190;
  const logoY = 58;
  if (cvm) dibujarCirculo(ctx, cvm, cx - logoBox / 2, logoY, logoBox, true);
  else await dibujarLogo(ctx, cx - logoBox / 2, logoY, logoBox, true); // respaldo: logo MGG
  const headBottom = logoY + logoBox;

  ctx.textAlign = 'center';
  ctx.fillStyle = C.gold;
  ctx.font = `800 21px ${FONT}`;
  tracked(ctx, 'MINERAL GROUP GUAYANA C.A.', cx, headBottom + 34, 0.5);
  ctx.fillStyle = accent;
  roundRect(ctx, cx - 60, headBottom + 52, 120, 3, 2);
  ctx.fill();

  // Texto legal (alineado a la izquierda con márgenes).
  const margin = 50;
  const maxW = W - margin * 2;
  ctx.textAlign = 'left';
  ctx.fillStyle = C.text;
  ctx.font = `500 21px ${FONT}`;
  let y = headBottom + 92;
  y = parrafo(ctx, REV_P1, margin, y, maxW, 30);
  y += 20;
  ctx.fillStyle = C.primary3;
  ctx.font = `600 21px ${FONT}`;
  parrafo(ctx, REV_P2, margin, y, maxW, 30);

  // Contacto (abajo).
  ctx.textAlign = 'center';
  ctx.fillStyle = C.gold;
  ctx.font = `700 20px ${FONT}`;
  ctx.fillText(REV_EMAIL, cx, H - 84);
  ctx.fillStyle = C.text;
  ctx.font = `600 19px ${FONT}`;
  ctx.fillText(REV_WHATSAPP, cx, H - 58);
  ctx.fillStyle = accent;
  roundRect(ctx, 16, H - 36, W - 32, 20, 10);
  ctx.fill();

  return lienzoAPng(canvas);
}

/** Compat: el "carnet" por defecto es el frente. */
export const generarCarnetBlob = generarFrenteBlob;

/** Nombre de archivo sugerido. */
function nombreArchivo(p: Personal, cara: string): string {
  const base = `${p.nombre ?? ''}-${p.apellido ?? ''}`.trim().replace(/\s+/g, '-').replace(/[^\w\-áéíóúñ]/gi, '');
  return `carnet-${cara}-${base || 'personal'}.png`;
}

function descargarBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Genera y descarga las DOS caras del carnet (frente + reverso). */
export async function descargarCarnet(p: Personal): Promise<void> {
  const [frente, reverso] = await Promise.all([generarFrenteBlob(p), generarReversoBlob()]);
  descargarBlob(frente, nombreArchivo(p, 'frente'));
  // Pequeña espera para que el navegador no ignore la 2.ª descarga.
  await new Promise((r) => setTimeout(r, 350));
  descargarBlob(reverso, nombreArchivo(p, 'reverso'));
}
