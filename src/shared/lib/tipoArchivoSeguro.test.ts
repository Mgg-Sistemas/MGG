import { describe, expect, it } from 'vitest';
import { tipoArchivoSeguro } from './reportPreview';

const blob = (bytes: number[] | string, type = '') => new Blob([typeof bytes === 'string' ? bytes : new Uint8Array(bytes)], { type });

describe('vista previa · solo se muestra lo que de verdad es PDF o imagen', () => {
  it('reconoce PDF e imágenes por sus primeros bytes', async () => {
    expect(await tipoArchivoSeguro(blob('%PDF-1.7 ...'))).toBe('application/pdf');
    expect(await tipoArchivoSeguro(blob([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBe('image/png');
    expect(await tipoArchivoSeguro(blob([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(await tipoArchivoSeguro(blob('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
  });
  it('HTML o SVG disfrazados no se muestran, aunque digan ser PDF o imagen', async () => {
    expect(await tipoArchivoSeguro(blob('<html><script>alert(1)</script>', 'application/pdf'))).toBeNull();
    expect(await tipoArchivoSeguro(blob('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>', 'image/svg+xml'))).toBeNull();
  });
});
