import { describe, expect, it } from 'vitest';
import { errorArchivoAdjunto, errorArchivoSubible, MAX_BYTES_ADJUNTO, MAX_BYTES_ORIGINAL, rutaAdjunto } from './minutaAdjuntos.repository';

function archivo(nombre: string, tipo: string, bytes: number): File {
  return new File([new Uint8Array(Math.min(bytes, 1024))], nombre, { type: tipo });
  // El tamaño real se simula con Object.defineProperty abajo cuando hace falta.
}
function conTamano(f: File, bytes: number): File {
  Object.defineProperty(f, 'size', { value: bytes });
  return f;
}

describe('errorArchivoAdjunto', () => {
  it('acepta JPG, PNG, WEBP y PDF', () => {
    expect(errorArchivoAdjunto(archivo('a.jpg', 'image/jpeg', 10))).toBeNull();
    expect(errorArchivoAdjunto(archivo('a.png', 'image/png', 10))).toBeNull();
    expect(errorArchivoAdjunto(archivo('a.webp', 'image/webp', 10))).toBeNull();
    expect(errorArchivoAdjunto(archivo('a.pdf', 'application/pdf', 10))).toBeNull();
  });
  it('rechaza lo que no sea imagen ni PDF, diciendo qué se acepta', () => {
    const e = errorArchivoAdjunto(archivo('a.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 10));
    expect(e).toMatch(/JPG|PNG|WEBP|PDF/i);
  });
  it('acepta un original de 12 MB: el límite de 10 MB se mide después de comprimir', () => {
    const foto = conTamano(archivo('a.jpg', 'image/jpeg', 10), 12 * 1024 * 1024);
    expect(errorArchivoAdjunto(foto)).toBeNull();
  });
  it('rechaza un original por encima del tope previo, con su propio mensaje', () => {
    const e = errorArchivoAdjunto(conTamano(archivo('a.jpg', 'image/jpeg', 10), MAX_BYTES_ORIGINAL + 1));
    expect(e).toMatch(/50 MB/);
    expect(e).toMatch(/comprimir/i);
    expect(e).not.toMatch(/10 MB/);
  });
  it('acepta un archivo justo en el tope previo', () => {
    const justo = conTamano(archivo('a.jpg', 'image/jpeg', 10), MAX_BYTES_ORIGINAL);
    expect(errorArchivoAdjunto(justo)).toBeNull();
  });
  it('rechaza un archivo vacío (0 bytes), aunque el tipo sea válido', () => {
    const e = errorArchivoAdjunto(archivo('a.pdf', 'application/pdf', 0));
    expect(e).not.toBeNull();
    expect(e).toMatch(/vac/i);
  });
  it('un tipo inválido se reporta como tipo aunque además esté vacío', () => {
    const e = errorArchivoAdjunto(archivo('a.docx', 'application/msword', 0));
    expect(e).toMatch(/JPG|PNG|WEBP|PDF/i);
  });
});

describe('errorArchivoSubible', () => {
  const mb = (n: number) => n * 1024 * 1024;
  it('rechaza 11 MB, diciendo cuánto pesa y el máximo', () => {
    const e = errorArchivoSubible(conTamano(archivo('a.jpg', 'image/jpeg', 10), mb(11)));
    expect(e).toMatch(/11\.0 MB/);
    expect(e).toMatch(/10 MB/);
    expect(e).not.toMatch(/comprimid/i);
  });
  it('acepta 9 MB', () => {
    expect(errorArchivoSubible(conTamano(archivo('a.jpg', 'image/jpeg', 10), mb(9)))).toBeNull();
  });
  it('acepta justo el máximo', () => {
    expect(errorArchivoSubible(conTamano(archivo('a.jpg', 'image/jpeg', 10), MAX_BYTES_ADJUNTO))).toBeNull();
  });
  it('rechaza 0 bytes', () => {
    expect(errorArchivoSubible(archivo('a.jpg', 'image/jpeg', 0))).toMatch(/vac/i);
  });
});

describe('rutaAdjunto', () => {
  const U = '123e4567-e89b-12d3-a456-426614174000';
  it('deriva la extensión del tipo, con un mapa fijo', () => {
    expect(rutaAdjunto('m1', 'image/jpeg', U)).toBe(`m1/${U}.jpg`);
    expect(rutaAdjunto('m1', 'image/png', U)).toBe(`m1/${U}.png`);
    expect(rutaAdjunto('m1', 'image/webp', U)).toBe(`m1/${U}.webp`);
    expect(rutaAdjunto('m1', 'application/pdf', U)).toBe(`m1/${U}.pdf`);
  });
  it('un tipo desconocido o vacío cae a bin', () => {
    expect(rutaAdjunto('m1', 'application/zip', U)).toBe(`m1/${U}.bin`);
    expect(rutaAdjunto('m1', '', U)).toBe(`m1/${U}.bin`);
  });
  it('tiene la forma minutaId/uuid.ext, con una sola barra', () => {
    for (const t of ['image/jpeg', 'application/pdf', 'x/y']) {
      const r = rutaAdjunto('m1', t, U);
      expect(r.split('/')).toHaveLength(2);
      expect(r).toMatch(/^m1\/[0-9a-f-]+\.[a-z]+$/);
    }
  });
  it('no altera el minutaId', () => {
    const id = 'a1b2c3d4-0000-4000-8000-abcdefabcdef';
    expect(rutaAdjunto(id, 'image/png', U).startsWith(`${id}/`)).toBe(true);
  });
});
