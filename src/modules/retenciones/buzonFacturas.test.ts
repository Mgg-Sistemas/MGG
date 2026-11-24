import { describe, expect, it } from 'vitest';
import {
  validarArchivosFactura,
  clasificarArchivos,
  MAX_IMAGENES_FACTURA,
  MAX_PDFS_FACTURA,
} from './adjuntosBuzon';
import { mensajeFacturaExterna } from './mensajeFacturaExterna';
import type { FacturaExternaBuzon } from './facturasBuzon.repository';
import {
  isSonidoRetencionesHabilitado,
  toggleSonidoRetenciones,
} from './soundRetenciones';
import {
  isAvisosPantallaHabilitados,
  setAvisosPantallaHabilitados,
  isNotificacionesSoportadas,
  getEstadoPermisoNotificacion,
  lanzarAvisoFactura,
  detenerAlertaTitulo,
} from './notificacionesDispositivo';

describe('Buzón móvil de facturas · Reglas de adjuntos y formato WhatsApp', () => {
  it('permite hasta 4 imágenes y hasta 2 PDFs', () => {
    expect(MAX_IMAGENES_FACTURA).toBe(4);
    expect(MAX_PDFS_FACTURA).toBe(2);
    const img1 = new File(['fake1'], 'foto1.jpg', { type: 'image/jpeg' });
    const img2 = new File(['fake2'], 'foto2.png', { type: 'image/png' });
    const pdf1 = new File(['fakePdf'], 'factura.pdf', { type: 'application/pdf' });

    const val = validarArchivosFactura([img1, img2, pdf1], 0, 0);
    expect(val.error).toBeNull();
    expect(val.valido).toBe(true);
    expect(val.imagenes).toHaveLength(2);
    expect(val.pdfs).toHaveLength(1);
  });

  it('clasifica correctamente imágenes y PDFs', () => {
    const img = new File(['f'], 'recibo.webp', { type: 'image/webp' });
    const pdf = new File(['p'], 'soporte.pdf', { type: 'application/pdf' });
    const otro = new File(['x'], 'documento.docx', { type: 'application/msword' });

    const { imagenes, pdfs, otros } = clasificarArchivos([img, pdf, otro]);
    expect(imagenes).toHaveLength(1);
    expect(pdfs).toHaveLength(1);
    expect(otros).toHaveLength(1);
  });

  it('rechaza cargar más de 4 imágenes', () => {
    const imgs = [
      new File(['1'], 'foto1.jpg', { type: 'image/jpeg' }),
      new File(['2'], 'foto2.jpg', { type: 'image/jpeg' }),
      new File(['3'], 'foto3.jpg', { type: 'image/jpeg' }),
    ];
    // Si ya tiene 2 imágenes existentes, sumar 3 da 5 -> debe rechazar
    const val = validarArchivosFactura(imgs, 2, 0);
    expect(val.valido).toBe(false);
    expect(val.error).toMatch(/hasta 4 imágenes/i);
  });

  it('rechaza cargar más de 2 documentos PDF', () => {
    const pdfs = [
      new File(['1'], 'doc1.pdf', { type: 'application/pdf' }),
      new File(['2'], 'doc2.pdf', { type: 'application/pdf' }),
    ];
    // Si ya tiene 1 PDF existente, sumar 2 da 3 -> debe rechazar
    const val = validarArchivosFactura(pdfs, 0, 1);
    expect(val.valido).toBe(false);
    expect(val.error).toMatch(/1 o 2 documentos PDF/i);
  });

  it('rechaza archivos que no son imágenes ni PDFs', () => {
    const archivoRaro = new File(['xyz'], 'programa.exe', { type: 'application/x-msdownload' });
    const val = validarArchivosFactura([archivoRaro], 0, 0);
    expect(val.valido).toBe(false);
    expect(val.error).toMatch(/no es compatible/i);
  });

  it('rechaza archivos mayores a 12 MB', () => {
    const grande = new File(['x'], 'pesado.jpg', { type: 'image/jpeg' });
    Object.defineProperty(grande, 'size', { value: 13 * 1024 * 1024 });
    const val = validarArchivosFactura([grande], 0, 0);
    expect(val.valido).toBe(false);
    expect(val.error).toMatch(/supera el tamaño máximo/i);
  });

  it('genera un mensaje estructurado para WhatsApp con todos los datos clave en USD', () => {
    const fac: FacturaExternaBuzon = {
      id: 'fac-1',
      empresaId: 'empresa-prueba-uno',
      empresaNombre: 'Empresa de Prueba Uno C.A.',
      tipoDocumento: 'factura',
      proveedorNombre: 'Suministros Industriales 2020 C.A.',
      proveedorRif: 'J-12345678-9',
      facturaNumero: '000845',
      facturaControl: '00-112',
      facturaFecha: '2026-10-28',
      montoTotal: 1500,
      moneda: 'USD',
      tasa: 45.5,
      montoBs: 68250,
      descripcion: 'Compra de filtros de motor en proveedor externo',
      observaciones: 'Pago realizado con caja chica de campo',
      estatus: 'recibida',
      adjuntos: [
        { id: '1', facturaId: 'fac-1', tipo: 'imagen', path: '1.jpg', nombreOriginal: '1.jpg', tamanoBytes: 100, mimeType: 'image/jpeg', createdAt: '' },
        { id: '2', facturaId: 'fac-1', tipo: 'pdf', path: 'fac.pdf', nombreOriginal: 'fac.pdf', tamanoBytes: 500, mimeType: 'application/pdf', createdAt: '' },
      ],
      createdBy: 'campo@ejemplo.com',
      createdByName: 'Persona de Prueba',
      createdAt: '2026-10-28T10:00:00Z',
      updatedAt: null,
    };

    const txt = mensajeFacturaExterna(fac);
    expect(txt).toContain('FACTURA EXTERNA REGISTRADA');
    expect(txt).toContain('Empresa de Prueba Uno C.A.');
    expect(txt).toContain('Suministros Industriales 2020 C.A.');
    expect(txt).toContain('J-12345678-9');
    expect(txt).toContain('000845');
    expect(txt).toContain('00-112');
    expect(txt).toContain('28/10/2026');
    expect(txt).toContain('1.500,00');
    expect(txt).toContain('Monto:* Bs 68.250,00');   // el monto que se informa va en Bs
    expect(txt).toContain('En dólares:* $ 1.500,00');
    expect(txt).toContain('Estado:* Recibida');
    expect(txt).toContain('1 foto y 1 PDF');
    expect(txt).toContain('Persona de Prueba');
  });

  it('genera un mensaje estructurado para facturas en Bolívares (Bs)', () => {
    const fac: FacturaExternaBuzon = {
      id: 'fac-2',
      empresaId: 'empresa-prueba-dos',
      empresaNombre: 'Empresa de Prueba Dos C.A.',
      tipoDocumento: 'nota_credito',
      proveedorNombre: 'Ferretería El Tornillo C.A.',
      proveedorRif: 'J-98765432-1',
      facturaNumero: '1234',
      facturaControl: null,
      facturaFecha: '2026-10-29',
      montoTotal: 5000,
      moneda: 'Bs',
      tasa: null,
      montoBs: 5000,
      descripcion: 'Tornillos y tuercas',
      observaciones: null,
      estatus: 'retenida',
      adjuntos: [],
      createdBy: 'user@test.com',
      createdAt: '2026-10-29T10:00:00Z',
      updatedAt: null,
    };

    const txt = mensajeFacturaExterna(fac);
    expect(txt).toContain('Empresa de Prueba Dos C.A.');
    expect(txt).toContain('Bs 5.000,00');
    expect(txt).toContain('Estado:* Retención hecha');
    expect(txt).toContain('Sin soportes adjuntos');
  });
});

describe('Sonido de Retenciones · Control y Preferencias', () => {
  it('permite alternar el estado del sonido y recordarlo', () => {
    const inicial = isSonidoRetencionesHabilitado();
    const alternado = toggleSonidoRetenciones();
    expect(alternado).toBe(!inicial);
    expect(isSonidoRetencionesHabilitado()).toBe(alternado);

    // Restaurar
    toggleSonidoRetenciones();
  });
});

describe('Avisos en Pantalla / Móvil (Sin instalación)', () => {
  it('permite habilitar y deshabilitar avisos en pantalla', () => {
    setAvisosPantallaHabilitados(false);
    expect(isAvisosPantallaHabilitados()).toBe(false);

    setAvisosPantallaHabilitados(true);
    expect(isAvisosPantallaHabilitados()).toBe(true);
  });

  it('reporta estado de soporte o permisos en el entorno de ejecución', () => {
    // En Node / Vitest sin DOM nativo de navegador, debe manejar unsupported limpiamente
    const soportado = isNotificacionesSoportadas();
    const estado = getEstadoPermisoNotificacion();
    expect(typeof soportado).toBe('boolean');
    expect(['granted', 'denied', 'default', 'unsupported']).toContain(estado);
  });

  it('ejecuta lanzarAvisoFactura y detenerAlertaTitulo sin arrojar excepciones', () => {
    expect(() => {
      lanzarAvisoFactura({
        empresaNombre: 'Empresa de Prueba',
        proveedorNombre: 'Proveedor Test',
        moneda: 'USD',
        montoTotal: 150,
      });
      detenerAlertaTitulo();
    }).not.toThrow();
  });
});

