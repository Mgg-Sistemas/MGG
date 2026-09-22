/* ============================================================
   MGG · Un .zip de un solo archivo, hecho en el navegador

   ¿Por qué hace falta? El respaldo de la base es un .sql de decenas de MB.
   Adjuntarlo a un correo no funciona: Brevo corta en 20 MB y el base64 del
   adjunto pesa un tercio MÁS que el archivo. Un .sql comprime como 10 a 1,
   así que zipearlo es lo que hace que el respaldo entre en un correo — hoy
   y cuando la base sea el triple de grande.

   Además Brevo acepta `.zip` en su lista de extensiones y NO acepta `.sql`
   (por eso antes se mandaba como `.sql.txt`, que es el mismo peso con otro
   nombre: no resolvía nada).

   Se arma a mano en vez de traer una librería: un ZIP de un solo archivo son
   tres bloques (encabezado local, directorio central y cierre) y el navegador
   ya sabe comprimir con CompressionStream. Meter una dependencia entera al
   bundle para esto sería pagar de más.
   ============================================================ */

/** Tabla del CRC-32 (polinomio 0xEDB88320), que es el que exige el formato ZIP. */
const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 de los bytes, como lo pide el ZIP. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLA_CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** ¿El navegador sabe comprimir? Sin esto no hay zip y hay que avisar, no fallar mudo. */
export function puedeComprimir(): boolean {
  return typeof CompressionStream !== 'undefined';
}

/** Comprime con DEFLATE crudo, que es lo que guarda adentro un ZIP. */
async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate-raw');
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Escritor de enteros chiquito: el ZIP es todo little-endian. */
function escritor(tam: number) {
  const buf = new Uint8Array(tam);
  let p = 0;
  return {
    u16(v: number) { buf[p++] = v & 0xff; buf[p++] = (v >>> 8) & 0xff; },
    u32(v: number) { buf[p++] = v & 0xff; buf[p++] = (v >>> 8) & 0xff; buf[p++] = (v >>> 16) & 0xff; buf[p++] = (v >>> 24) & 0xff; },
    bytes(b: Uint8Array) { buf.set(b, p); p += b.length; },
    get resultado() { return buf; },
    get pos() { return p; },
  };
}

/**
 * Arma un .zip con UN archivo adentro.
 *
 * Guarda la fecha en 0 a propósito (campo de fecha DOS): el respaldo ya lleva
 * su fecha en el nombre y en su encabezado, y una marca de tiempo variable
 * haría que dos respaldos del mismo contenido no sean el mismo archivo.
 */
export async function zipDeUnArchivo(nombreInterno: string, contenido: string): Promise<Uint8Array> {
  if (!puedeComprimir()) throw new Error('Este navegador no puede comprimir el archivo. Usá la descarga directa.');

  const datos = new TextEncoder().encode(contenido);
  const nombre = new TextEncoder().encode(nombreInterno);
  const comprimido = await deflate(datos);
  const crc = crc32(datos);

  const TAM_LOCAL = 30 + nombre.length;
  const TAM_CENTRAL = 46 + nombre.length;
  const w = escritor(TAM_LOCAL + comprimido.length + TAM_CENTRAL + 22);

  /* ── Encabezado local ── */
  w.u32(0x04034b50);          // firma
  w.u16(20);                  // versión mínima para extraer (2.0 = deflate)
  w.u16(0x0800);              // bandera: el nombre viene en UTF-8
  w.u16(8);                   // método: deflate
  w.u16(0); w.u16(0);         // hora y fecha DOS (fijas, ver arriba)
  w.u32(crc);
  w.u32(comprimido.length);
  w.u32(datos.length);
  w.u16(nombre.length);
  w.u16(0);                   // sin campo extra
  w.bytes(nombre);
  w.bytes(comprimido);

  /* ── Directorio central ── */
  const inicioCentral = w.pos;
  w.u32(0x02014b50);
  w.u16(20);                  // versión que lo creó
  w.u16(20);                  // versión mínima para extraer
  w.u16(0x0800);
  w.u16(8);
  w.u16(0); w.u16(0);
  w.u32(crc);
  w.u32(comprimido.length);
  w.u32(datos.length);
  w.u16(nombre.length);
  w.u16(0); w.u16(0);         // sin extra, sin comentario
  w.u16(0);                   // número de disco
  w.u16(0);                   // atributos internos
  w.u32(0);                   // atributos externos
  w.u32(0);                   // dónde empieza el encabezado local
  w.bytes(nombre);

  /* ── Cierre (end of central directory) ── */
  w.u32(0x06054b50);
  w.u16(0); w.u16(0);         // disco actual / disco del directorio
  w.u16(1); w.u16(1);         // un archivo acá, uno en total
  w.u32(TAM_CENTRAL);
  w.u32(inicioCentral);
  w.u16(0);                   // sin comentario

  return w.resultado;
}

/** Base64 de bytes, en tandas para no reventar la pila con archivos grandes. */
export function bytesABase64(bytes: Uint8Array): string {
  let s = '';
  const TANDA = 0x8000;       // 32 kB por vuelta: más grande revienta apply()
  for (let i = 0; i < bytes.length; i += TANDA) {
    s += String.fromCharCode(...bytes.subarray(i, i + TANDA));
  }
  return btoa(s);
}

/** Cuánto pesa un base64 de N bytes: 4 caracteres por cada 3 bytes, redondeado. */
export function pesoEnBase64(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}

/** Para decirle al usuario cuánto pesa, no cuántos bytes tiene. */
export function megas(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
