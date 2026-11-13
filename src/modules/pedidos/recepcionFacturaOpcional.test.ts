import { describe, expect, it } from 'vitest';
import {
  errorArchivoFactura,
  MAX_FACTURAS_ALMACEN,
} from './facturasOrden.repository';

describe('Factura opcional en recepciones de almacén (12-11-2026)', () => {
  it('respeta el límite de 6 facturas de almacén', () => {
    expect(MAX_FACTURAS_ALMACEN).toBe(6);
  });

  it('valida formatos válidos de factura (PDF o imagen)', () => {
    const fPdf = { name: 'factura_001.pdf', type: 'application/pdf', size: 1024 * 500 } as File;
    expect(errorArchivoFactura(fPdf)).toBeNull();

    const fImg = { name: 'factura_foto.jpg', type: 'image/jpeg', size: 1024 * 1024 * 2 } as File;
    expect(errorArchivoFactura(fImg)).toBeNull();
  });

  it('rechaza archivos que no son imagen ni PDF o que superan 10 MB', () => {
    const fInvalido = { name: 'documento.docx', type: 'application/msword', size: 1024 } as File;
    expect(errorArchivoFactura(fInvalido)).toMatch(/no es una foto ni un PDF/);

    const fPesado = { name: 'factura_pesada.pdf', type: 'application/pdf', size: 11 * 1024 * 1024 } as File;
    expect(errorArchivoFactura(fPesado)).toMatch(/pesa más de 10 MB/);
  });
});

