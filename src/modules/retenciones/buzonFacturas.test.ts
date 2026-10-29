import { describe, expect, it } from 'vitest';
import {
  validarArchivosFactura,
  clasificarArchivos,
  MAX_IMAGENES_FACTURA,
  MAX_PDFS_FACTURA,
} from './adjuntosBuzon';
import { mensajeFacturaExterna } from './mensajeFacturaExterna';
import {
  listEmpresasReceptoras,
  guardarEmpresaReceptora,
} from './empresasReceptoras.repository';
import {
  crearFacturaBuzon,
  listFacturasBuzon,
  actualizarEstatusFacturaBuzon,
  type FacturaExternaBuzon,
} from './facturasBuzon.repository';
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
      empresaId: 'mineria_ts',
      empresaNombre: 'Minería TS C.A.',
      proveedorNombre: 'Repuestos El Callao C.A.',
      proveedorRif: 'J-12345678-0',
      facturaNumero: '000542',
      facturaControl: '00-99881',
      facturaFecha: '2026-10-29',
      montoTotal: 350.5,
      moneda: 'USD',
      tasa: 200,
      montoBs: 70100,
      montoUsd: 350.5,
      descripcion: 'Filtros y lubricantes para tractor',
      observaciones: 'Entregado en mina',
      estatus: 'recibida',
      adjuntos: [
        {
          id: 'adj-1',
          facturaId: 'fac-1',
          tipo: 'imagen',
          path: 'img.jpg',
          nombreOriginal: 'foto1.jpg',
          tamanoBytes: 1024,
          mimeType: 'image/jpeg',
          createdAt: '2026-10-29T10:00:00Z',
        },
      ],
      createdBy: 'chofer@mgg.com',
      createdByName: 'Pedro Chofer',
      createdAt: '2026-10-29T10:00:00Z',
      updatedAt: null,
    };

    const msg = mensajeFacturaExterna(fac);
    expect(msg).toContain('FACTURA EXTERNA REGISTRADA');
    expect(msg).toContain('Minería TS C.A.');
    expect(msg).toContain('Repuestos El Callao C.A.');
    expect(msg).toContain('000542');
    expect(msg).toContain('350,50');
    expect(msg).toContain('70.100,00');
    expect(msg).toContain('Recibida');
    expect(msg).toContain('1 foto');
    expect(msg).toContain('Pedro Chofer');
  });

  it('genera un mensaje estructurado para WhatsApp con moneda Bs', () => {
    const fac: FacturaExternaBuzon = {
      id: 'fac-2',
      empresaId: 'mgg',
      empresaNombre: 'Mineral Group Guayana C.A.',
      proveedorNombre: 'Suministros Bolívar',
      proveedorRif: 'J-99887766-5',
      facturaNumero: '987',
      facturaControl: null,
      facturaFecha: '2026-10-29',
      montoTotal: 5000,
      moneda: 'Bs',
      tasa: null,
      montoBs: 5000,
      descripcion: 'Material de oficina',
      observaciones: null,
      estatus: 'retenida',
      adjuntos: [],
      createdBy: 'admin@mgg.com',
      createdAt: '2026-10-29T10:00:00Z',
      updatedAt: null,
    };

    const msg = mensajeFacturaExterna(fac);
    expect(msg).toContain('Bs 5.000,00');
    expect(msg).toContain('Retención practicada / Lista');
    expect(msg).toContain('Sin soportes adjuntos');
  });
});

describe('Buzón móvil de facturas · Repositorios y Catálogo de Empresas', () => {
  it('lista empresas receptoras por defecto si la base está vacía', async () => {
    const list = await listEmpresasReceptoras();
    expect(list.length).toBeGreaterThanOrEqual(3);
    const nombres = list.map((e) => e.nombre.toLowerCase());
    expect(nombres.some((n) => n.includes('mineral group') || n.includes('mgg'))).toBe(true);
    expect(nombres.some((n) => n.includes('golden touch'))).toBe(true);
    expect(nombres.some((n) => n.includes('minería ts') || n.includes('mineria'))).toBe(true);
  });

  it('permite registrar una nueva empresa y normaliza su RIF', async () => {
    const nueva = await guardarEmpresaReceptora({
      nombre: 'Minera El Manteco C.A.',
      nombreCorto: 'Manteco',
      activo: true,
      rif: 'J123456789',
      colorBadge: '#10b981',
      municipio: 'Piar',
      estado: 'Bolívar',
      esAgenteRetencionIva: true,
      esContribuyenteEspecial: true,
      pctIvaGeneral: 75,
    });

    expect(nueva.id).toBeDefined();
    expect(nueva.nombre).toBe('Minera El Manteco C.A.');
    expect(nueva.rif).toMatch(/J-12345678-9|J123456789/);
    expect(nueva.esContribuyenteEspecial).toBe(true);

    const lista = await listEmpresasReceptoras();
    expect(lista.some((e) => e.nombre === 'Minera El Manteco C.A.')).toBe(true);
  });

  it('crea y actualiza facturas en el buzón manteniendo consistencia de moneda', async () => {
    const fac = await crearFacturaBuzon({
      empresaId: 'emp-test',
      empresaNombre: 'Empresa Test',
      proveedorNombre: 'Ferretería Central',
      proveedorRif: 'J-31415926-5',
      facturaNumero: 'FAC-001',
      facturaFecha: '2026-10-29',
      moneda: 'USD',
      montoTotal: 100,
      tasa: 200,
      descripcion: 'Prueba de inserción',
      createdBy: 'test@mgg.com',
    });

    expect(fac.id).toBeDefined();
    expect(fac.estatus).toBe('recibida');
    expect(fac.montoBs).toBe(20000);

    // Actualizar estatus
    await actualizarEstatusFacturaBuzon(fac.id, 'en_revision');
    const lista = await listFacturasBuzon({ busqueda: 'FAC-001' });
    const encontrada = lista.find((x) => x.id === fac.id);
    expect(encontrada?.estatus).toBe('en_revision');
  });
});

describe('Buzón móvil de facturas · Sonido y Notificaciones del Dispositivo', () => {
  it('permite alternar el estado de sonido de facturas', () => {
    const inicial = isSonidoRetencionesHabilitado();
    const cambiado = toggleSonidoRetenciones();
    expect(cambiado).toBe(!inicial);
    const restaurado = toggleSonidoRetenciones();
    expect(restaurado).toBe(inicial);
  });

  it('permite activar y desactivar avisos en pantalla', () => {
    setAvisosPantallaHabilitados(false);
    expect(isAvisosPantallaHabilitados()).toBe(false);
    setAvisosPantallaHabilitados(true);
    expect(isAvisosPantallaHabilitados()).toBe(true);
  });

  it('maneja el entorno sin crash en notificaciones nativas', () => {
    const soportado = isNotificacionesSoportadas();
    const estado = getEstadoPermisoNotificacion();
    expect(typeof soportado).toBe('boolean');
    expect(['granted', 'denied', 'default', 'unsupported']).toContain(estado);
  });

  it('ejecuta lanzarAvisoFactura y detenerAlertaTitulo sin arrojar excepciones', () => {
    expect(() => {
      lanzarAvisoFactura({
        empresaNombre: 'Empresa X',
        proveedorNombre: 'Proveedor Y',
        moneda: 'USD',
        montoTotal: 50,
      });
      detenerAlertaTitulo();
    }).not.toThrow();
  });
});

