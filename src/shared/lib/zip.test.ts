import { describe, it, expect } from 'vitest';
import { bytesABase64, crc32, megas, pesoEnBase64, zipDeUnArchivo } from './zip';

const bytes = (s: string) => new TextEncoder().encode(s);
const leerU32 = (b: Uint8Array, p: number) => (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0;
const leerU16 = (b: Uint8Array, p: number) => b[p] | (b[p + 1] << 8);

describe('CRC-32', () => {
  /* Los valores de referencia del estándar. Si esto se rompe, el .zip lo va a
     rechazar el programa que lo abra, no nosotros: por eso se fija acá. */
  it('da los valores conocidos del estándar', () => {
    expect(crc32(bytes(''))).toBe(0);
    expect(crc32(bytes('123456789'))).toBe(0xcbf43926);
    expect(crc32(bytes('a'))).toBe(0xe8b7be43);
    expect(crc32(bytes('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });

  it('cambia si cambia un solo byte', () => {
    expect(crc32(bytes('hola'))).not.toBe(crc32(bytes('holA')));
  });
});

describe('el .zip que se arma a mano', () => {
  const CONTENIDO = '-- respaldo\n' + 'INSERT INTO public.x (a) VALUES (1);\n'.repeat(200);

  it('arranca con la firma de un ZIP', async () => {
    const z = await zipDeUnArchivo('respaldo.sql', CONTENIDO);
    expect(leerU32(z, 0)).toBe(0x04034b50);
  });

  it('cierra con el bloque de fin de directorio', async () => {
    const z = await zipDeUnArchivo('respaldo.sql', CONTENIDO);
    expect(leerU32(z, z.length - 22)).toBe(0x06054b50);
  });

  it('dice que adentro hay un solo archivo', async () => {
    const z = await zipDeUnArchivo('respaldo.sql', CONTENIDO);
    expect(leerU16(z, z.length - 22 + 8)).toBe(1);
    expect(leerU16(z, z.length - 22 + 10)).toBe(1);
  });

  it('guarda el nombre del archivo tal cual', async () => {
    const z = await zipDeUnArchivo('mgg-respaldo-2026-09-22.sql', CONTENIDO);
    const largo = leerU16(z, 26);
    const nombre = new TextDecoder().decode(z.subarray(30, 30 + largo));
    expect(nombre).toBe('mgg-respaldo-2026-09-22.sql');
  });

  it('guarda el CRC y el tamaño original del contenido', async () => {
    const z = await zipDeUnArchivo('x.sql', CONTENIDO);
    expect(leerU32(z, 14)).toBe(crc32(bytes(CONTENIDO)));
    expect(leerU32(z, 22)).toBe(bytes(CONTENIDO).length);
  });

  it('comprime de verdad: un .sql repetitivo pesa una fracción', async () => {
    const z = await zipDeUnArchivo('x.sql', CONTENIDO);
    // Es la razón de ser del archivo: si no achicara, el correo seguiría
    // rebotando por tamaño.
    expect(z.length).toBeLessThan(bytes(CONTENIDO).length / 4);
  });

  it('un contenido vacío igual produce un zip válido', async () => {
    const z = await zipDeUnArchivo('vacio.sql', '');
    expect(leerU32(z, 0)).toBe(0x04034b50);
    expect(leerU32(z, z.length - 22)).toBe(0x06054b50);
  });
});

describe('el peso que se le informa al usuario', () => {
  it('el base64 pesa un tercio más que el archivo', () => {
    expect(pesoEnBase64(3)).toBe(4);
    expect(pesoEnBase64(3_000_000)).toBe(4_000_000);
    // El límite del correo son 20 MB de ADJUNTO, no de archivo: 15 MB de
    // archivo dan exactamente 20 MB y ya no entran. Ese es el margen real.
    expect(pesoEnBase64(15 * 1024 * 1024)).toBe(20 * 1024 * 1024);
    expect(pesoEnBase64(16 * 1024 * 1024)).toBeGreaterThan(20 * 1024 * 1024);
  });

  it('se muestra en MB, no en bytes', () => {
    expect(megas(1024 * 1024)).toBe('1.0 MB');
    expect(megas(22 * 1024 * 1024)).toBe('22.0 MB');
  });

  it('el base64 de bytes grandes no revienta', () => {
    const grande = new Uint8Array(200_000).fill(65);
    expect(bytesABase64(grande).length).toBe(pesoEnBase64(grande.length));
  });
});
