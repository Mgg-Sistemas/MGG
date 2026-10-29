import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  validarArchivosFactura,
  crearFacturaExterna,
  actualizarEmpresaFacturaExterna,
  actualizarEstadoFacturaExterna,
  MAX_IMAGENES_FACTURA,
  MAX_PDFS_FACTURA,
} from './facturasExternas.repository';

const crearMockFile = (name: string, type: string): File => {
  return new File(['contenido ficticio'], name, { type });
};

describe('validarArchivosFactura', () => {
  it('permite hasta 4 imágenes y hasta 2 PDFs', () => {
    const archivos = [
      crearMockFile('factura_p1.jpg', 'image/jpeg'),
      crearMockFile('factura_p2.png', 'image/png'),
      crearMockFile('factura_p3.webp', 'image/webp'),
      crearMockFile('soporte.jpeg', 'image/jpeg'),
      crearMockFile('factura_digital.pdf', 'application/pdf'),
      crearMockFile('comprobante.pdf', 'application/pdf'),
    ];

    const { imagenes, pdfs } = validarArchivosFactura(archivos);
    expect(imagenes).toHaveLength(4);
    expect(pdfs).toHaveLength(2);
  });

  it('rechaza si se cargan más de 4 imágenes', () => {
    const archivos = [
      crearMockFile('f1.jpg', 'image/jpeg'),
      crearMockFile('f2.jpg', 'image/jpeg'),
      crearMockFile('f3.jpg', 'image/jpeg'),
      crearMockFile('f4.jpg', 'image/jpeg'),
      crearMockFile('f5.jpg', 'image/jpeg'),
    ];

    expect(() => validarArchivosFactura(archivos)).toThrow(
      new RegExp(`máximo ${MAX_IMAGENES_FACTURA} fotos`, 'i')
    );
  });

  it('rechaza si se cargan más de 2 archivos PDF', () => {
    const archivos = [
      crearMockFile('doc1.pdf', 'application/pdf'),
      crearMockFile('doc2.pdf', 'application/pdf'),
      crearMockFile('doc3.pdf', 'application/pdf'),
    ];

    expect(() => validarArchivosFactura(archivos)).toThrow(
      new RegExp(`máximo ${MAX_PDFS_FACTURA} archivos PDF`, 'i')
    );
  });

  it('rechaza archivos que no sean imágenes ni PDF', () => {
    const archivos = [
      crearMockFile('factura.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    ];

    expect(() => validarArchivosFactura(archivos)).toThrow(/no es compatible/i);
  });
});

describe('validaciones de entrada de crearFacturaExterna', () => {
  const baseInput = {
    empresa: 'GOLDEN',
    proveedorNombre: 'Ferretería Industrial C.A.',
    proveedorRif: 'J-50129993-5',
    numeroFactura: 'FAC-0001',
    fechaFactura: '2026-10-29',
    montoTotal: 1500,
  };

  it('rechaza proveedorNombre menor a 2 caracteres', async () => {
    await expect(
      crearFacturaExterna({ ...baseInput, proveedorNombre: 'A' }, [])
    ).rejects.toThrow(/razón social o nombre/i);
  });

  it('rechaza proveedorRif con formato inválido', async () => {
    await expect(
      crearFacturaExterna({ ...baseInput, proveedorRif: '1234' }, [])
    ).rejects.toThrow(/RIF del proveedor no es válido/i);
  });

  it('rechaza numeroFactura vacío', async () => {
    await expect(
      crearFacturaExterna({ ...baseInput, numeroFactura: '   ' }, [])
    ).rejects.toThrow(/número de la factura/i);
  });

  it('rechaza fechaFactura vacía', async () => {
    await expect(
      crearFacturaExterna({ ...baseInput, fechaFactura: '' }, [])
    ).rejects.toThrow(/fecha de la factura/i);
  });

  it('rechaza montoTotal igual o menor a cero', async () => {
    await expect(
      crearFacturaExterna({ ...baseInput, montoTotal: 0 }, [])
    ).rejects.toThrow(/mayor a 0/i);

    await expect(
      crearFacturaExterna({ ...baseInput, montoTotal: -50 }, [])
    ).rejects.toThrow(/mayor a 0/i);
  });
});

describe('actualizarEmpresaFacturaExterna', () => {
  it('rechaza empresa vacía', async () => {
    await expect(actualizarEmpresaFacturaExterna('factura-123', '   ')).rejects.toThrow(
      /indica la empresa a asignar/i
    );
  });
});


