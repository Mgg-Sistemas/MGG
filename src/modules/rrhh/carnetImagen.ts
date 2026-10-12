/* ============================================================
   MGG · RRHH · Carnet de identificación (imagen PNG)
   Carnet vertical CR80 (el tamaño estándar de las tarjetas): 53,98 × 85,6 mm,
   a 300 DPI (638×1011 px). También sale en PDF a tamaño real.

   Formato «estilo La Cantera, con la marca MGG» (12-10-2026). La administradora
   pidió quitar los logos de la CVM, de Motor Minero y del Gobierno y armar el
   carnet PARECIDO (no igual) al de La Cantera (repo Mgg-Sistemas/lacantera,
   src/lib/ficha/carnet.ts): se mide en milímetros, como la regla con la que
   se comprueba el impreso.
   · FRENTE: banda oscura arriba con el logo en un disco blanco y la razón
     social con el RIF; la foto montada sobre la banda; el nombre; el cargo
     en naranja; cinco filas de datos (cédula, departamento, ingreso, sangre,
     vigencia) con sus rayitas; y la franja naranja del pie con la FICHA.
   · REVERSO: el logo completo de MGG, «ESCANEE PARA VERIFICAR», el QR
     GRANDE (30 mm) que abre la verificación en vivo (activo = datos;
     desactivado = logo de la empresa), la cédula escrita debajo (para
     buscar a mano si el QR no lee), la firma del autorizado y el sello de
     MGG, y la misma franja naranja del pie.
   Todo se dibuja en un <canvas>: no depende de estilos ni fuentes web.
   ============================================================ */
import qrcode from 'qrcode-generator';
import type { Personal } from '@/shared/lib/types';
import { date as fmtDate } from '@/shared/lib/format';
import { loadLogoDataUrl } from '@/shared/lib/pdfLogo';
import { nombreDeCarnet } from './fichaPersonal';
import { textoVence } from './carnetVence';
import { lineasSaludQR } from './condicionesSalud';

// CR80: 53,98 × 85,6 mm (ISO/IEC 7810 ID-1) a 300 DPI. 1 mm = 300 / 25.4 px.
export const CARNET_MM = { ancho: 53.98, alto: 85.6 } as const;
const DPI = 300;
const MM = DPI / 25.4;
const W = Math.round(CARNET_MM.ancho * MM); // 638
const H = Math.round(CARNET_MM.alto * MM);  // 1011
/** Milímetros a píxeles del lienzo: el diseño se mide como el impreso. */
const mm = (v: number) => v * MM;
/** Puntos tipográficos a píxeles del lienzo. */
const pt = (v: number) => (v / 72) * DPI;

// La marca en el carnet: banda oscura, naranja MGG para el cargo y el pie.
const BANDA = '#1c1c1c';
const NARANJA = '#f28c00';
const CARGO = '#b85c00';

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
  /** La rayita bajo cada fila de datos. */
  rayita: string;
  /** Logos sobre placas blancas (en el fondo negro). */
  placas: boolean;
  /** Color al que se repinta la firma y el sello (en negro, claro). */
  tinta?: string;
}
const PALETAS: Record<TemaCarnet, Paleta> = {
  blanco: { fondo: '#ffffff', fondo2: '#ffffff', borde: '#c9a227', naranja: NARANJA, texto: '#111111', gris: '#6b7280', punteado: '#1a1a1a', sinFoto: '#eef1f5', rayita: '#e9e4de', placas: false },
  negro: { fondo: '#0d1014', fondo2: '#1a212b', borde: '#d4af37', naranja: NARANJA, texto: '#f2f4f7', gris: '#9aa6b5', punteado: '#d6dbe2', sinFoto: '#252d38', rayita: '#2a3240', placas: true, tinta: '#f2f4f7' },
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
async function dibujarFoto(ctx: CanvasRenderingContext2D, p: Personal, x: number, y: number, w: number, h: number, pal: Paleta, marco: 'naranja' | 'ninguno' = 'naranja') {
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
  if (marco === 'ninguno') return;
  ctx.lineWidth = 8;
  ctx.strokeStyle = pal.naranja;
  roundRect(ctx, x - 4, y - 4, w + 8, h + 8, 6);
  ctx.stroke();
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

const RAZON_SOCIAL = 'MINERAL GROUP GUAYANA';
const FORMA_RIF = 'C.A. · RIF J-50221930-7';

/** V-18425462 → V-18.425.462: con puntos se lee de un vistazo contra la cédula. */
function cedulaLegible(c: string | null | undefined): string {
  const s0 = (c ?? '').trim().toUpperCase().replace(/\s+/g, '');
  const m = /^([VEJPG])?-?(\d+)$/.exec(s0);
  if (!m) return s0 || '—';
  return `${m[1] ?? 'V'}-${m[2].replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

/** Espaciado entre letras (lo soportan los navegadores actuales; si no, sale normal). */
function espaciado(ctx: CanvasRenderingContext2D, px: number) {
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if ('letterSpacing' in c) c.letterSpacing = `${px}px`;
}

/** La franja naranja del pie, igual en las dos caras: así se reconocen como del mismo carnet. */
function franjaPie(ctx: CanvasRenderingContext2D): { y: number; alto: number } {
  const alto = mm(7.1);
  const y = H - alto;
  ctx.fillStyle = NARANJA;
  ctx.fillRect(0, y, W, alto);
  return { y, alto };
}

/** El icono de MGG en un disco blanco (sobre la banda oscura no se vería sin él). */
async function dibujarIconoEnDisco(ctx: CanvasRenderingContext2D, x: number, y: number, lado: number) {
  let icono: HTMLImageElement | null = null;
  try { icono = await loadImage(await loadLogoDataUrl()); } catch { icono = null; }
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + lado / 2, y + lado / 2, lado / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.clip();
  if (icono) { const m = lado * 0.1; ctx.drawImage(icono, x + m, y + m, lado - 2 * m, lado - 2 * m); }
  ctx.restore();
}

/** El logo completo de MGG (con el RIF). Si falta, el cuadrado de siempre. */
function cargarLogoEmpresa(): Promise<HTMLImageElement | null> {
  return cargarDePublic(['Mineral Group Guayana.jpg', 'image.jpeg']);
}

/** Genera el FRENTE del carnet. */
export async function generarFrenteBlob(p: Personal, tema: TemaCarnet = 'blanco'): Promise<Blob> {
  const pal = paleta(tema);
  const { canvas, ctx } = nuevoLienzo(pal);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  // ── Banda oscura con el logo y la razón social ──
  const bandaH = mm(21);
  ctx.fillStyle = BANDA;
  ctx.fillRect(0, 0, W, bandaH);
  ctx.fillStyle = NARANJA;
  ctx.fillRect(0, bandaH, W, mm(0.8));
  await dibujarIconoEnDisco(ctx, mm(4), mm(3), mm(8));
  // La razón social se encoge hasta entrar en la banda (a 7,2 pt se salía por la derecha).
  ctx.fillStyle = '#ffffff';
  espaciado(ctx, mm(0.1));
  let sr = 7.2;
  ctx.font = `800 ${pt(sr)}px ${FONT}`;
  while (ctx.measureText(RAZON_SOCIAL).width > W - mm(14.2) - mm(3) && sr > 5) { sr -= 0.1; ctx.font = `800 ${pt(sr)}px ${FONT}`; }
  ctx.fillText(RAZON_SOCIAL, mm(14.2), mm(7.6));
  espaciado(ctx, 0);
  ctx.fillStyle = 'rgba(255,255,255,.78)';
  ctx.font = `400 ${pt(5.4)}px ${FONT}`;
  ctx.fillText(FORMA_RIF, mm(14.2), mm(11.8));

  // ── Foto montada sobre la banda, con marco blanco ──
  const fx = mm(14); const fy = mm(15); const fw = mm(26); const fh = mm(29);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(fx, fy, fw, fh);
  ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  await dibujarFoto(ctx, p, fx + mm(1), fy + mm(1), fw - mm(2), fh - mm(2), pal, 'ninguno');
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';

  // ── Nombre y cargo ──
  ctx.textAlign = 'center';
  ctx.fillStyle = pal.texto;
  const nombre = nombreDeCarnet(p.nombre, p.apellido) || '—';
  let size = 9.5;
  ctx.font = `800 ${pt(size)}px ${FONT}`;
  while (ctx.measureText(nombre).width > mm(46) && size > 6.5) { size -= 0.25; ctx.font = `800 ${pt(size)}px ${FONT}`; }
  ctx.fillText(nombre, W / 2, mm(50.2));
  const cargo = (p.cargo ?? '').trim().toUpperCase();
  if (cargo) {
    ctx.fillStyle = CARGO;
    let sc = 6;
    ctx.font = `700 ${pt(sc)}px ${FONT}`;
    espaciado(ctx, mm(0.1));
    while (ctx.measureText(cargo).width > mm(46) && sc > 4.4) { sc -= 0.2; ctx.font = `700 ${pt(sc)}px ${FONT}`; }
    ctx.fillText(cargo, W / 2, mm(54.6));
    espaciado(ctx, 0);
  }

  // ── Filas de datos: rótulo a la izquierda, valor a la derecha, rayita debajo ──
  const vence = textoVence(p.carnet_vence);
  const filas: Array<[string, string]> = [
    ['Cédula', cedulaLegible(p.cedula)],
    ['Departamento', (p.departamento ?? '').trim() || '—'],
    ['Ingreso', p.fecha_ingreso ? fmtDate(p.fecha_ingreso) : '—'],
    ['Sangre', (p.grupo_sanguineo ?? '').trim() || '—'],
    ['Vigencia', vence || '—'],
  ];
  let y = mm(59.6);
  for (const [clave, valor] of filas) {
    ctx.textAlign = 'left';
    ctx.font = `400 ${pt(6)}px ${FONT}`;
    ctx.fillStyle = pal.gris;
    ctx.fillText(clave, mm(4.5), y);
    ctx.textAlign = 'right';
    ctx.fillStyle = clave === 'Vigencia' && vence && p.carnet_vence && p.carnet_vence < new Date().toISOString().slice(0, 10) ? '#e5484d' : pal.texto;
    let sv = 6.2;
    ctx.font = `700 ${pt(sv)}px ${FONT}`;
    while (ctx.measureText(valor).width > mm(30) && sv > 4.6) { sv -= 0.2; ctx.font = `700 ${pt(sv)}px ${FONT}`; }
    ctx.fillText(valor, mm(49.5), y);
    ctx.fillStyle = pal.rayita;
    ctx.fillRect(mm(4.5), y + mm(1.1), mm(45), Math.max(1, mm(0.25)));
    y += mm(3.9);
  }

  // ── Franja del pie con la ficha ──
  const pie = franjaPie(ctx);
  ctx.fillStyle = BANDA;
  ctx.textAlign = 'left';
  ctx.font = `700 ${pt(5.2)}px ${FONT}`;
  espaciado(ctx, mm(0.18));
  ctx.fillText('FICHA', mm(4.5), pie.y + pie.alto - mm(2.5));
  espaciado(ctx, 0);
  ctx.textAlign = 'right';
  ctx.font = `800 ${pt(11)}px ${FONT}`;
  ctx.fillText(String(p.numero_ficha ?? '').trim() || '—', mm(49.5), pie.y + pie.alto - mm(2.2));

  return lienzoAPng(canvas);
}

/** Genera el REVERSO del carnet: la marca, el QR grande, la firma y el sello. */
export async function generarReversoBlob(p: Personal, tema: TemaCarnet = 'blanco'): Promise<Blob> {
  const pal = paleta(tema);
  const { canvas, ctx } = nuevoLienzo(pal);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'center';
  const [empresa, firmaImg, selloImg] = await Promise.all([
    cargarLogoEmpresa(),
    cargarDePublic(['firma-autorizado-carnet.jpeg', 'firma-autorizado-carnet.jpg', 'firma-autorizado-carnet.png']),
    cargarDePublic(['sello-mgg.jpeg', 'sello-mgg.jpg', 'sello-mgg.png']),
  ]);

  // ── El logo completo (con el RIF), arriba y centrado ──
  const lw = mm(40); const lh = mm(15);
  placa(ctx, pal, W / 2 - lw / 2 - mm(2), mm(4), lw + mm(4), lh + mm(4), 18);
  if (empresa) dibujarContenido(ctx, empresa, empresa.naturalWidth || empresa.width, empresa.naturalHeight || empresa.height, W / 2 - lw / 2, mm(6), lw, lh);

  ctx.fillStyle = pal.rayita;
  ctx.fillRect(mm(10), mm(24.5), W - mm(20), Math.max(1, mm(0.25)));

  ctx.fillStyle = CARGO;
  ctx.font = `700 ${pt(5.4)}px ${FONT}`;
  espaciado(ctx, mm(0.15));
  ctx.fillText('ESCANEE PARA VERIFICAR', W / 2, mm(28.6));
  espaciado(ctx, 0);

  // ── El QR en vivo, grande: se lee de medio metro y aguanta el plástico rayado ──
  const lado = mm(30);
  const qrY = mm(31.5);
  dibujarQR(ctx, urlQRCarnet(p), W / 2 - lado / 2, qrY, lado);

  // La cédula escrita, por si el QR no se lee: con eso se busca a mano en el sistema.
  ctx.fillStyle = pal.texto;
  ctx.font = `700 ${pt(6.4)}px ${FONT}`;
  espaciado(ctx, mm(0.2));
  ctx.fillText(`C.I. ${cedulaLegible(p.cedula)}`, W / 2, qrY + lado + mm(4.4));
  espaciado(ctx, 0);

  // ── Firma del autorizado (izquierda) y sello de MGG (derecha) ──
  const filaY = qrY + lado + mm(6.6);
  const filaH = mm(78.3) - filaY;
  const cajaW = (W - mm(12)) / 2;
  if (firmaImg) { const cv = sinFondoBlanco(firmaImg, pal.tinta); dibujarContenido(ctx, cv, cv.width, cv.height, mm(4), filaY, cajaW, filaH); }
  if (selloImg) { const cv = sinFondoBlanco(selloImg, pal.tinta); dibujarContenido(ctx, cv, cv.width, cv.height, mm(8) + cajaW, filaY, cajaW, filaH); }

  // ── La misma franja del pie ──
  const pie = franjaPie(ctx);
  ctx.fillStyle = BANDA;
  ctx.font = `700 ${pt(5)}px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.fillText('RIF J-50221930-7', mm(4.5), pie.y + pie.alto - mm(2.5));
  ctx.textAlign = 'right';
  ctx.fillText('Puerto Ordaz · Edo. Bolívar', mm(49.5), pie.y + pie.alto - mm(2.5));

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
  descargarBlob(await generarReversoBlob(p, tema), nombreArchivo(p, 'reverso', tema));
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
    generarReversoBlob(p, tema).then(blobADataUrl),
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
