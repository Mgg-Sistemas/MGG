/* ============================================================
   MGG · RRHH · Carnet de identificación (imagen PNG)
   Carnet vertical CR80 (el tamaño estándar de las tarjetas): 53,98 × 85,6 mm,
   a 300 DPI (638×1011 px). También sale en PDF a tamaño real.

   Formato «Aliados CVM» (06-10-2026), el que pidió la administradora a
   partir del carnet de Golden Touch:
   · FRENTE: fondo blanco con borde dorado; arriba el logo de la CVM y el de
     Motor Minero en Marcha; la foto con marco naranja; nombre y C.I.; el logo
     de MGG; cargo y vigencia. Un QR chico abajo a la derecha abre la
     verificación en vivo (activo = datos; desactivado = logo de la empresa).
   · REVERSO: el sello «CVM Aliados» sobre un recuadro punteado con el texto
     legal y el contacto; firma del autorizado y sello de MGG; una raya
     naranja y el logo del Gobierno Bolivariano / Ministerio de Desarrollo
     Minero Ecológico.
   Todo se dibuja en un <canvas>: no depende de estilos ni fuentes web.
   ============================================================ */
import qrcode from 'qrcode-generator';
import type { Personal } from '@/shared/lib/types';
import { nombreDeCarnet } from './fichaPersonal';
import { textoVence } from './carnetVence';
import { lineasSaludQR } from './condicionesSalud';

// CR80: 53,98 × 85,6 mm (ISO/IEC 7810 ID-1) a 300 DPI. 1 mm = 300 / 25.4 px.
export const CARNET_MM = { ancho: 53.98, alto: 85.6 } as const;
const DPI = 300;
const MM = DPI / 25.4;
const W = Math.round(CARNET_MM.ancho * MM); // 638
const H = Math.round(CARNET_MM.alto * MM);  // 1011

/**
 * El mismo formato en dos fondos (06-10-2026): BLANCO (el de imprimir) y NEGRO.
 * En negro los logos institucionales van sobre placas blancas redondeadas:
 * tienen letras oscuras que sobre negro no se leerían.
 */
export type TemaCarnet = 'blanco' | 'negro';

interface Paleta {
  fondo: string; fondo2: string;
  borde: string;      // dorado del borde del frente
  naranja: string;    // marco de la foto y raya del reverso
  texto: string; gris: string; punteado: string;
  sinFoto: string;
  /** Logos sobre placas blancas (en el fondo negro). */
  placas: boolean;
  /** Color al que se repinta la firma y el sello (en negro, claro). */
  tinta?: string;
}
const PALETAS: Record<TemaCarnet, Paleta> = {
  blanco: { fondo: '#ffffff', fondo2: '#ffffff', borde: '#c9a227', naranja: '#f28c00', texto: '#111111', gris: '#6b7280', punteado: '#1a1a1a', sinFoto: '#eef1f5', placas: false },
  negro: { fondo: '#0d1014', fondo2: '#1a212b', borde: '#d4af37', naranja: '#f28c00', texto: '#f2f4f7', gris: '#9aa6b5', punteado: '#d6dbe2', sinFoto: '#252d38', placas: true, tinta: '#f2f4f7' },
};
const paleta = (t?: TemaCarnet | string | null): Paleta => (t === 'negro' ? PALETAS.negro : PALETAS.blanco);

/** Placa blanca redondeada detrás de un logo (solo en el fondo negro). */
function placa(ctx: CanvasRenderingContext2D, pal: Paleta, x: number, y: number, w: number, h: number, r = 18) {
  if (!pal.placas) return;
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
}
const FONT = 'Arial, "Helvetica Neue", Helvetica, sans-serif';

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

/** Carga la primera imagen de /public que exista, probando varios nombres. */
async function cargarDePublic(candidatos: string[]): Promise<HTMLImageElement | null> {
  const base = import.meta.env.BASE_URL;
  for (const nombre of candidatos) {
    try {
      const img = await loadImage(`${base}${nombre.split('/').map(encodeURIComponent).join('/')}`);
      if (img.width > 1) return img; // en dev un 404 devuelve el index.html: no decodifica
    } catch { /* probamos el siguiente */ }
  }
  return null;
}

/**
 * Un logo en JPEG con su transparencia aparte (una máscara en grises): así
 * vinieron dentro del PDF del carnet. Sin la máscara el fondo sale negro.
 */
async function logoConAlfa(jpg: string, alfa: string): Promise<CanvasImageSource & { width: number; height: number } | null> {
  const [img, mask] = await Promise.all([cargarDePublic([jpg]), cargarDePublic([alfa])]);
  if (!img) return null;
  if (!mask) return img;
  const cv = document.createElement('canvas');
  cv.width = img.naturalWidth || img.width;
  cv.height = img.naturalHeight || img.height;
  const cx = cv.getContext('2d');
  if (!cx) return img;
  cx.drawImage(img, 0, 0);
  const m = document.createElement('canvas');
  m.width = cv.width; m.height = cv.height;
  const mx = m.getContext('2d');
  if (!mx) return img;
  mx.drawImage(mask, 0, 0, cv.width, cv.height);
  try {
    const d = cx.getImageData(0, 0, cv.width, cv.height);
    const a = mx.getImageData(0, 0, cv.width, cv.height).data;
    for (let i = 0; i < d.data.length; i += 4) d.data[i + 3] = a[i];
    cx.putImageData(d, 0, 0);
  } catch { return img; }
  return cv;
}

/** Dibuja una imagen dentro de una caja, sin deformarla y centrada. */
function dibujarContenido(
  ctx: CanvasRenderingContext2D, src: CanvasImageSource, w0: number, h0: number,
  x: number, y: number, maxW: number, maxH: number,
): void {
  if (!w0 || !h0) return;
  const k = Math.min(maxW / w0, maxH / h0);
  const w = w0 * k;
  const h = h0 * k;
  ctx.drawImage(src, x + (maxW - w) / 2, y + (maxH - h) / 2, w, h);
}

/* Rampa de transparencia para firmas y sellos escaneados (papel → transparente). */
const PAPEL = 235;
const TINTA = 120;
function sinFondoBlanco(img: HTMLImageElement, tinta?: string): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = img.naturalWidth || img.width;
  cv.height = img.naturalHeight || img.height;
  const cx = cv.getContext('2d');
  if (!cx) return cv;
  cx.drawImage(img, 0, 0);
  let datos: ImageData;
  try { datos = cx.getImageData(0, 0, cv.width, cv.height); } catch { return cv; }
  const px = datos.data;
  const rgb = tinta ? [parseInt(tinta.slice(1, 3), 16), parseInt(tinta.slice(3, 5), 16), parseInt(tinta.slice(5, 7), 16)] : null;
  for (let i = 0; i < px.length; i += 4) {
    const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    px[i + 3] = lum >= PAPEL ? 0 : lum <= TINTA ? 255 : Math.round((255 * (PAPEL - lum)) / (PAPEL - TINTA));
    if (rgb && px[i + 3] > 0) { px[i] = rgb[0]; px[i + 1] = rgb[1]; px[i + 2] = rgb[2]; }
  }
  cx.putImageData(datos, 0, 0);
  return cv;
}

/** Iniciales (nombre + apellido) para el marco cuando no hay foto. */
function iniciales(p: Personal): string {
  const a = (p.nombre ?? '').trim()[0] ?? '';
  const b = (p.apellido ?? '').trim()[0] ?? '';
  return (a + b).toUpperCase() || '·';
}

/** La foto (cover, con el encuadre que eligió el usuario) en marco naranja. */
async function dibujarFoto(ctx: CanvasRenderingContext2D, p: Personal, x: number, y: number, w: number, h: number, pal: Paleta) {
  let img: HTMLImageElement | null = null;
  if (p.foto_url) {
    try { img = await loadImage(p.foto_url, 'anonymous'); } catch { img = null; }
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  if (img) {
    const zoom = Math.min(4, Math.max(1, Number(p.foto_zoom) || 1));
    const posX = Math.min(1, Math.max(0, p.foto_pos_x == null ? 0.5 : Number(p.foto_pos_x)));
    const posY = Math.min(1, Math.max(0, p.foto_pos_y == null ? 0.5 : Number(p.foto_pos_y)));
    const scale = Math.max(w / img.width, h / img.height) * zoom;
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.drawImage(img, x - (dw - w) * posX, y - (dh - h) * posY, dw, dh);
  } else {
    ctx.fillStyle = pal.sinFoto;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = pal.gris;
    ctx.font = `800 110px ${FONT}`;
    ctx.fillText(iniciales(p), x + w / 2, y + h / 2);
  }
  ctx.restore();
  ctx.lineWidth = 8;
  ctx.strokeStyle = pal.naranja;
  roundRect(ctx, x - 4, y - 4, w + 8, h + 8, 6);
  ctx.stroke();
}

/** Parte un texto en líneas que quepan en maxW. */
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

/** Escribe un texto centrado bajando la letra hasta que entre en maxW (y en `maxLineas`). */
function textoAjustado(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, maxW: number, size: number, min: number, maxLineas = 1, peso = 700): number {
  let s = size;
  ctx.font = `${peso} ${s}px ${FONT}`;
  let lines = wrapText(ctx, text, maxW);
  while ((lines.length > maxLineas || lines.some((l) => ctx.measureText(l).width > maxW)) && s > min) {
    s -= 1;
    ctx.font = `${peso} ${s}px ${FONT}`;
    lines = wrapText(ctx, text, maxW);
  }
  let yy = y;
  for (const ln of lines.slice(0, maxLineas)) { ctx.fillText(ln, cx, yy); yy += s + 4; }
  return yy;
}

/**
 * Lo que lleva el QR desde el 05-10-2026: un ENLACE a la verificación en vivo.
 * Si la persona está activa, la página muestra sus datos; si está desactivada,
 * manda al logo de la empresa. Va siempre al dominio de producción.
 */
export const URL_CARNET = 'https://sistema.mineralgroupguayana.com/#/carnet/';
export function urlQRCarnet(p: Pick<Personal, 'id'>): string {
  return `${URL_CARNET}${p.id}`;
}

/** El texto que llevaba el QR antes (datos escritos). Se conserva como referencia. */
export function textoQR(p: Personal): string {
  const nombre = `${p.nombre ?? ''} ${p.apellido ?? ''}`.trim();
  const emerg = [p.contacto_emergencia, p.contacto_emergencia_tlf].filter(Boolean).join(' · ');
  return [
    'MGG · CARNET',
    `Nombre: ${nombre}`,
    p.cedula ? `Cédula: ${p.cedula}` : '',
    p.carnet_vence ? `Carnet vence: ${textoVence(p.carnet_vence)}` : '',
    p.cargo ? `Cargo: ${p.cargo}` : '',
    p.departamento ? `Departamento: ${p.departamento}` : '',
    p.telefono ? `Teléfono: ${p.telefono}` : '',
    p.grupo_sanguineo ? `Grupo sanguíneo: ${p.grupo_sanguineo}` : '',
    emerg ? `Emergencia: ${emerg}` : '',
    ...lineasSaludQR(p),
  ].filter(Boolean).join('\n');
}

/** Dibuja el QR (módulos nítidos) dentro de un cuadrado. */
function dibujarQR(ctx: CanvasRenderingContext2D, data: string, x: number, y: number, size: number) {
  const qr = qrcode(0, 'M');
  qr.addData(unescape(encodeURIComponent(data)), 'Byte');
  qr.make();
  const count = qr.getModuleCount();
  const quiet = 2;
  const cell = Math.floor(size / (count + quiet * 2));
  const qrSize = cell * (count + quiet * 2);
  const ox = x + Math.round((size - qrSize) / 2);
  const oy = y + Math.round((size - qrSize) / 2);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(ox, oy, qrSize, qrSize);
  ctx.fillStyle = '#000000';
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) ctx.fillRect(ox + (c + quiet) * cell, oy + (r + quiet) * cell, cell, cell);
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
  const insertAt = 33; // firma (8) + IHDR (25)
  const ppu = Math.round(dpi / 0.0254);
  const data = new Uint8Array(9);
  const dv = new DataView(data.buffer);
  dv.setUint32(0, ppu);
  dv.setUint32(4, ppu);
  data[8] = 1;
  const chunk = pngChunk('pHYs', data);
  const out = new Uint8Array(buf.length + chunk.length);
  out.set(buf.subarray(0, insertAt), 0);
  out.set(chunk, insertAt);
  out.set(buf.subarray(insertAt), insertAt + chunk.length);
  return new Blob([out], { type: 'image/png' });
}

function lienzoAPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo generar la imagen'))), 'image/png');
  }).then((b) => pngConDpi(b, DPI));
}

/** Lienzo blanco del tamaño del carnet. */
function nuevoLienzo(pal: Paleta): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('El navegador no soporta canvas 2D.');
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, pal.fondo);
  g.addColorStop(1, pal.fondo2);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  return { canvas, ctx };
}

// Texto legal del reverso (según lo indicado por la empresa).
const REV_P1 = 'Credencial de uso exclusivo para las alianzas en minerales estratégicos suscritas en la República Bolivariana de Venezuela. Agradecemos a todas las autoridades civiles, militares e institucionales prestar la mayor colaboración posible al portador de esta identificación.';
const REV_P2 = 'La persona portadora de esta credencial pertenece al grupo de alianzas de minerales estratégicos de la Corporación Venezolana de Minería.';
const REV_EMAIL = 'info@mineralgroupguayana.com';
const REV_WHATSAPP = 'WhatsApp +58 424-9349731';

/** El logo completo de MGG (con el RIF). Si falta, el cuadrado de siempre. */
function cargarLogoEmpresa(): Promise<HTMLImageElement | null> {
  return cargarDePublic(['Mineral Group Guayana.jpg', 'image.jpeg']);
}

/** Genera el FRENTE del carnet. */
export async function generarFrenteBlob(p: Personal, tema: TemaCarnet = 'blanco'): Promise<Blob> {
  const pal = paleta(tema);
  const { canvas, ctx } = nuevoLienzo(pal);
  const cx = W / 2;

  // Borde dorado redondeado.
  ctx.lineWidth = 9;
  ctx.strokeStyle = pal.borde;
  roundRect(ctx, 12, 12, W - 24, H - 24, 34);
  ctx.stroke();

  // Encabezado: CVM a la izquierda, Motor Minero en Marcha a la derecha.
  const [cvm, motor, empresa] = await Promise.all([
    logoConAlfa('carnet/cvm.jpg', 'carnet/cvm-alfa.png'),
    logoConAlfa('carnet/motor-minero.jpg', 'carnet/motor-minero-alfa.png'),
    cargarLogoEmpresa(),
  ]);
  // En negro, una franja blanca detrás de los dos logos.
  placa(ctx, pal, 30, 28, W - 60, 182, 24);
  if (cvm) dibujarContenido(ctx, cvm, cvm.width, cvm.height, 38, 40, 300, 150);
  if (motor) dibujarContenido(ctx, motor, motor.width, motor.height, W - 38 - 175, 30, 175, 175);

  // Foto con marco naranja.
  const fotoW = 236;
  const fotoH = 290;
  const fotoY = 218;
  await dibujarFoto(ctx, p, cx - fotoW / 2, fotoY, fotoW, fotoH, pal);

  // Nombre (hasta dos líneas) y cédula.
  ctx.fillStyle = pal.texto;
  const nombre = nombreDeCarnet(p.nombre, p.apellido) || '—';
  let y = fotoY + fotoH + 46;
  y = textoAjustado(ctx, nombre, cx, y, W - 80, 36, 24, 2, 800);
  textoAjustado(ctx, p.cedula ? `C.I. ${p.cedula}` : 'C.I. —', cx, y + 2, W - 80, 36, 24, 1, 800);
  y += 40;

  // Logo de la empresa.
  const logoY = y + 22;
  const logoH = 132;
  placa(ctx, pal, 66, logoY - 8, W - 132, logoH + 16, 16);
  if (empresa) dibujarContenido(ctx, empresa, empresa.naturalWidth || empresa.width, empresa.naturalHeight || empresa.height, 70, logoY, W - 140, logoH);

  // Cargo y vigencia. El QR va abajo a la derecha: el texto se acomoda para no pisarlo.
  const qrSize = 116;
  const qrX = W - 34 - qrSize;
  const qrY = H - 34 - qrSize;
  const maxTexto = 2 * (qrX - 12 - cx);
  ctx.fillStyle = pal.texto;
  let ty = logoY + logoH + 42;
  const cargo = (p.cargo ?? '').trim();
  if (cargo) ty = textoAjustado(ctx, cargo, cx, ty, maxTexto, 31, 20, 2, 800);
  const vence = textoVence(p.carnet_vence);
  if (vence) textoAjustado(ctx, `Vigencia ${vence}`, cx, ty + 4, maxTexto, 31, 20, 1, 800);

  // QR en vivo (activo = datos; desactivado = logo de la empresa).
  dibujarQR(ctx, urlQRCarnet(p), qrX, qrY, qrSize);

  return lienzoAPng(canvas);
}

/** Recuadro con borde punteado (cuadraditos), como el del formato. */
function rectPunteado(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.setLineDash([4, 9]);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

/** Genera el REVERSO del carnet. */
export async function generarReversoBlob(tema: TemaCarnet = 'blanco'): Promise<Blob> {
  const pal = paleta(tema);
  const { canvas, ctx } = nuevoLienzo(pal);
  const cx = W / 2;
  const [aliados, gobierno, firmaImg, selloImg] = await Promise.all([
    cargarDePublic(['carnet/cvm-aliados.jpg', 'cvm.jpg']),
    cargarDePublic(['carnet/gobierno-minero.jpg']),
    cargarDePublic(['firma-autorizado-carnet.jpeg', 'firma-autorizado-carnet.jpg', 'firma-autorizado-carnet.png']),
    cargarDePublic(['sello-mgg.jpeg', 'sello-mgg.jpg', 'sello-mgg.png']),
  ]);

  // Recuadro punteado; el sello «CVM Aliados» se monta sobre su borde de arriba.
  const boxX = 34;
  const boxY = 150;
  const boxW = W - 68;
  const boxH = 520;
  rectPunteado(ctx, boxX, boxY, boxW, boxH, pal.punteado);
  if (aliados) {
    const lw = 250;
    const lh = Math.round(lw * (aliados.height / aliados.width));
    // Fondo detrás del sello para tapar el punteado que pasa por debajo
    // (en negro, una placa blanca: el sello tiene letras oscuras).
    // Solo hasta la línea de «Aliados» (80 % de la imagen): el resto es fondo
    // blanco que en el carnet negro taparía la primera línea del texto.
    const corte = 0.8;
    const dh = Math.round(lh * corte);
    if (pal.placas) placa(ctx, pal, cx - lw / 2 - 4, 14, lw + 8, dh + 14, 22);
    else { ctx.fillStyle = pal.fondo; ctx.fillRect(cx - lw / 2 + 12, boxY - 10, lw - 24, Math.round(lh * 0.62)); }
    ctx.drawImage(aliados, 0, 0, aliados.width, Math.round(aliados.height * corte), cx - lw / 2, 22, lw, dh);
  }

  // Texto legal, centrado.
  const maxW = boxW - 50;
  ctx.fillStyle = pal.texto;
  ctx.font = `400 22px ${FONT}`;
  let y = boxY + 130;
  for (const ln of wrapText(ctx, REV_P1, maxW)) { ctx.fillText(ln, cx, y); y += 29; }
  y += 20;
  for (const ln of wrapText(ctx, REV_P2, maxW)) { ctx.fillText(ln, cx, y); y += 29; }
  y += 22;
  ctx.font = `400 22px ${FONT}`;
  ctx.fillText(REV_EMAIL, cx, y); y += 29;
  ctx.fillText(REV_WHATSAPP, cx, y);

  // Firma del autorizado (izquierda) y sello de MGG (derecha).
  const filaY = boxY + boxH + 14;
  const filaH = 128;
  const cajaW = (W - 100) / 2;
  if (firmaImg) { const cv = sinFondoBlanco(firmaImg, pal.tinta); dibujarContenido(ctx, cv, cv.width, cv.height, 40, filaY, cajaW, filaH); }
  if (selloImg) { const cv = sinFondoBlanco(selloImg, pal.tinta); dibujarContenido(ctx, cv, cv.width, cv.height, 60 + cajaW, filaY, cajaW, filaH); }

  // Raya naranja y logo del Gobierno / Ministerio de Desarrollo Minero Ecológico.
  const rayaY = filaY + filaH + 12;
  ctx.fillStyle = pal.naranja;
  ctx.fillRect(70, rayaY, W - 140, 8);
  if (gobierno) {
    // Se recorta la franja verde de abajo de la imagen: queda solo el logo.
    const sx = 0; const sy = 40; const sw = gobierno.width; const sh = Math.round(gobierno.height * 0.66);
    const dh = H - (rayaY + 18) - 22;
    const dw = Math.round(dh * (sw / sh));
    placa(ctx, pal, cx - dw / 2 - 10, rayaY + 12, dw + 20, dh + 10, 14);
    ctx.drawImage(gobierno, sx, sy, sw, sh, cx - dw / 2, rayaY + 18, dw, dh);
  }

  return lienzoAPng(canvas);
}

/** Compat: el "carnet" por defecto es el frente. */
export const generarCarnetBlob = generarFrenteBlob;

function nombreArchivo(p: Personal, cara: string, tema: TemaCarnet = 'blanco'): string {
  const base = `${p.nombre ?? ''}-${p.apellido ?? ''}`.trim().replace(/\s+/g, '-').replace(/[^\w\-áéíóúñ]/gi, '');
  return `carnet-${cara}${tema === 'negro' ? '-negro' : ''}-${base || 'personal'}.png`;
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

/** Descarga SOLO el frente. */
export async function descargarFrente(p: Personal, tema: TemaCarnet = 'blanco'): Promise<void> {
  descargarBlob(await generarFrenteBlob(p, tema), nombreArchivo(p, 'frente', tema));
}

/** Descarga SOLO el reverso. */
export async function descargarReverso(p: Personal, tema: TemaCarnet = 'blanco'): Promise<void> {
  descargarBlob(await generarReversoBlob(tema), nombreArchivo(p, 'reverso', tema));
}

/** Genera y descarga las DOS caras (con una pausa: el navegador ignora la segunda si llegan juntas). */
export async function descargarCarnet(p: Personal, tema: TemaCarnet = 'blanco'): Promise<void> {
  await descargarFrente(p, tema);
  await new Promise((r) => setTimeout(r, 350));
  await descargarReverso(p, tema);
}

/* ───────── PDF para imprimir (06-10-2026) ─────────
   · «carta»: una hoja carta con las dos caras a TAMAÑO REAL (85,6 × 54 mm), una
     al lado de la otra, con marcas de corte. Para cualquier impresora: se
     imprime al 100 % («tamaño real», sin «ajustar a la página») y se recorta.
   · «tarjeta»: dos páginas del tamaño exacto del carnet (frente y reverso), para
     impresoras de carnets o imprentas. */
export type ModoPdfCarnet = 'carta' | 'tarjeta';

function blobADataUrl(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error('No se pudo leer la imagen del carnet'));
    fr.readAsDataURL(b);
  });
}

/** Marcas de corte en las cuatro esquinas de un rectángulo (fuera de él). */
function marcasDeCorte(doc: { line: (a: number, b: number, c: number, d: number) => unknown }, x: number, y: number, w: number, h: number) {
  const l = 4; const g = 1.5;
  for (const [cx, cy, dx, dy] of [[x, y, -1, -1], [x + w, y, 1, -1], [x, y + h, -1, 1], [x + w, y + h, 1, 1]] as const) {
    doc.line(cx + dx * g, cy, cx + dx * (g + l), cy);
    doc.line(cx, cy + dy * g, cx, cy + dy * (g + l));
  }
}

export async function carnetPdf(p: Personal, modo: ModoPdfCarnet = 'carta', tema: TemaCarnet = 'blanco'): Promise<void> {
  const [{ jsPDF }, { previewPdfDoc }, frente, reverso] = await Promise.all([
    import('jspdf'),
    import('@/shared/lib/reportPreview'),
    generarFrenteBlob(p, tema).then(blobADataUrl),
    generarReversoBlob(tema).then(blobADataUrl),
  ]);
  const { ancho, alto } = CARNET_MM;
  const nombre = `${p.nombre ?? ''} ${p.apellido ?? ''}`.trim();
  const base = nombreArchivo(p, 'pdf', tema).replace(/\.png$/, '');
  if (modo === 'tarjeta') {
    const doc = new jsPDF({ unit: 'mm', format: [ancho, alto], orientation: 'portrait' });
    doc.addImage(frente, 'PNG', 0, 0, ancho, alto);
    doc.addPage([ancho, alto], 'portrait');
    doc.addImage(reverso, 'PNG', 0, 0, ancho, alto);
    previewPdfDoc(doc, `${base}-tamano-carnet.pdf`);
    return;
  }
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' });
  const pw = doc.internal.pageSize.getWidth();
  const sep = 12;
  const x0 = (pw - (ancho * 2 + sep)) / 2;
  const y0 = 38;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
  doc.text(`Carnet · ${nombre || 'Personal'}`, pw / 2, 20, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(90);
  doc.text('Tamaño real 85,6 × 54 mm (CR80). Imprimir al 100 % («Tamaño real», sin «Ajustar a la página») y recortar por las marcas.', pw / 2, 27, { align: 'center' });
  doc.setTextColor(0);
  doc.addImage(frente, 'PNG', x0, y0, ancho, alto);
  doc.addImage(reverso, 'PNG', x0 + ancho + sep, y0, ancho, alto);
  doc.setDrawColor(120); doc.setLineWidth(0.2);
  marcasDeCorte(doc, x0, y0, ancho, alto);
  marcasDeCorte(doc, x0 + ancho + sep, y0, ancho, alto);
  doc.setFontSize(7.5); doc.setTextColor(120);
  doc.text('FRENTE', x0 + ancho / 2, y0 + alto + 9, { align: 'center' });
  doc.text('REVERSO', x0 + ancho + sep + ancho / 2, y0 + alto + 9, { align: 'center' });
  previewPdfDoc(doc, `${base}-carta.pdf`);
}
