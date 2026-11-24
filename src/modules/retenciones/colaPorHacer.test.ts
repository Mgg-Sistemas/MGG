import { describe, expect, it } from 'vitest';
import { construirColaPorHacer } from './colaPorHacer';
import type { Orden } from '@/shared/lib/types';
import type { FacturaBuzon } from './facturasBuzon.repository';
import type { FacturaDeOrigen } from '@/modules/libroFiscal/documentosOrigen.repository';
import type { RetencionItem } from './retenciones.repository';

// Fórmulas mínimas para mock
function mockOrden(id: string, over: Partial<Orden> = {}): Orden {
  return {
    id,
    codigo: `ORD-${id}`,
    oc_codigo: `OC-${id}`,
    proveedor_id: 'prov-1',
    solicitante_email: 'test@example.com',
    items: [],
    historial: [],
    total: 100,
    total_moneda: 'USD',
    estado: 'recibida',
    created_at: '2026-11-10T10:00:00Z',
    ...over,
  };
}

function mockBuzon(id: string, over: Partial<FacturaBuzon> = {}): FacturaBuzon {
  return {
    id,
    empresaId: 'empresa-golden-touch',
    empresaNombre: 'Golden Touch',
    tipoDocumento: 'factura',
    proveedorNombre: 'Proveedor Buzon',
    proveedorRif: 'J-12345678-0',
    facturaNumero: 'FAC-001',
    facturaControl: 'CTRL-001',
    facturaFecha: '2026-11-10',
    montoTotal: 250,
    moneda: 'USD',
    tasa: null,
    montoBs: 0,
    descripcion: 'Compra de insumos',
    observaciones: null,
    estatus: 'recibida',
    adjuntos: [{ id: 'adj-b1', facturaId: id, nombreOriginal: 'factura.pdf', path: 'buzon/factura.pdf', tamanoBytes: 1024, mimeType: 'application/pdf', tipo: 'pdf', createdAt: '2026-11-10' }],
    createdBy: 'user@test.com',
    createdAt: '2026-11-10T12:00:00Z',
    updatedAt: null,
    ...over,
  };
}

function mockFacturaOrigen(id: string, over: Partial<FacturaDeOrigen> = {}): FacturaDeOrigen {
  return {
    adjuntoId: `adj-${id}`,
    modulo: 'orden_factura',
    origen: { tipo: 'oc', id },
    bucket: 'compras-oc',
    path: `${id}/facturas/f.pdf`,
    nombre: 'f.pdf',
    contentType: 'application/pdf',
    subidoPor: 'compras@test.com',
    subidoEn: '2026-11-11T10:00:00Z',
    registrado: false,
    documentos: [],
    esFactura: true,
    ...over,
  };
}

describe('construirColaPorHacer · Rediseño de Retenciones (Etapa 1)', () => {
  const registradasVacias = new Map();
  const practicaDefecto = new Set(['iva', 'islr'] as const);

  describe('Regla estricta: Sin archivo adjunto no hay retención', () => {
    it('excluye órdenes que no tienen archivo de factura adjunto', () => {
      const sinArchivo: RetencionItem = {
        orden: mockOrden('oc-sin-archivo', { factura_recepcion_path: null }),
        proveedorNombre: 'Proveedor Sin Archivo',
      };
      const conArchivo: RetencionItem = {
        orden: mockOrden('oc-con-archivo', {
          factura_recepcion_path: 'oc-con-archivo/factura-recepcion-f.pdf',
          factura_recepcion_nombre: 'f.pdf',
        }),
        proveedorNombre: 'Proveedor Con Archivo',
      };

      const cola = construirColaPorHacer({
        empresaId: 'empresa-golden-touch',
        esGt: true,
        facturasBuzon: [],
        facturasCompras: [],
        pendientesOrdenes: [sinArchivo, conArchivo],
        registradas: registradasVacias,
        practica: practicaDefecto,
      });

      expect(cola).toHaveLength(1);
      expect(cola[0].codigo).toBe('OC-oc-con-archivo');
      expect(cola[0].archivoNombre).toBe('f.pdf');
    });

    it('excluye facturas de buzón que no tienen adjuntos', () => {
      const buzonSinAdjuntos = mockBuzon('b-vacio', { adjuntos: [] });
      const buzonConAdjuntos = mockBuzon('b-con-adjunto');

      const cola = construirColaPorHacer({
        empresaId: 'empresa-golden-touch',
        esGt: true,
        facturasBuzon: [buzonSinAdjuntos, buzonConAdjuntos],
        facturasCompras: [],
        pendientesOrdenes: [],
        registradas: registradasVacias,
        practica: practicaDefecto,
      });

      expect(cola).toHaveLength(1);
      expect(cola[0].id).toBe('buzon-b-con-adjunto');
    });

    it('incluye siempre facturas válidas de Compras (todas traen adjuntoId y path)', () => {
      const fc = mockFacturaOrigen('oc-compras-1');
      const cola = construirColaPorHacer({
        empresaId: 'empresa-golden-touch',
        esGt: true,
        facturasBuzon: [],
        facturasCompras: [fc],
        pendientesOrdenes: [],
        registradas: registradasVacias,
        practica: practicaDefecto,
      });

      expect(cola).toHaveLength(1);
      expect(cola[0].origen).toBe('compras_archivo');
      expect(cola[0].archivoNombre).toBe('f.pdf');
    });
  });

  describe('Regla multi-empresa: cola independiente por empresa', () => {
    it('para Golden Touch: muestra facturas de buzón de GT y compras de GT, pero no de filiales', () => {
      const buzonGt = mockBuzon('b-gt', { empresaId: 'empresa-golden-touch' });
      const buzonFilial = mockBuzon('b-filial', { empresaId: 'empresa-filial-1' });
      const fcGt = mockFacturaOrigen('oc-gt');

      const cola = construirColaPorHacer({
        empresaId: 'empresa-golden-touch',
        esGt: true,
        facturasBuzon: [buzonGt, buzonFilial],
        facturasCompras: [fcGt],
        pendientesOrdenes: [],
        registradas: registradasVacias,
        practica: practicaDefecto,
      });

      const ids = cola.map((x) => x.id);
      expect(ids).toContain('buzon-b-gt');
      expect(ids).toContain('compras-adj-oc-gt');
      expect(ids).not.toContain('buzon-b-filial');
    });

    it('para empresa filial: muestra solo facturas de buzón de esa filial, sin compras ni órdenes de GT', () => {
      const buzonGt = mockBuzon('b-gt', { empresaId: 'empresa-golden-touch' });
      const buzonFilial1 = mockBuzon('b-filial1', { empresaId: 'empresa-filial-1' });
      const buzonFilial2 = mockBuzon('b-filial2', { empresaId: 'empresa-filial-2' });
      const fcGt = mockFacturaOrigen('oc-gt');
      const ordenGt: RetencionItem = {
        orden: mockOrden('oc-gt-orden', { factura_recepcion_path: 'oc-gt-orden/factura.pdf' }),
        proveedorNombre: 'Prov GT',
      };

      const cola = construirColaPorHacer({
        empresaId: 'empresa-filial-1',
        esGt: false,
        facturasBuzon: [buzonGt, buzonFilial1, buzonFilial2],
        facturasCompras: [fcGt],
        pendientesOrdenes: [ordenGt],
        registradas: registradasVacias,
        practica: practicaDefecto,
      });

      expect(cola).toHaveLength(1);
      expect(cola[0].id).toBe('buzon-b-filial1');
      expect(cola[0].empresaId).toBe('empresa-filial-1');
    });
  });

  describe('Deduplicación entre archivo de Compras y orden de recepción', () => {
    it('no duplica una orden si ya está listada como archivo de Compras', () => {
      const ordenId = 'oc-compartida';
      const fc = mockFacturaOrigen(ordenId, { origen: { tipo: 'oc', id: ordenId } });
      const ordenItem: RetencionItem = {
        orden: mockOrden(ordenId, {
          factura_recepcion_path: `${ordenId}/recepcion.pdf`,
          factura_recepcion_nombre: 'recepcion.pdf',
        }),
        proveedorNombre: 'Proveedor Compartido',
      };

      const cola = construirColaPorHacer({
        empresaId: 'empresa-golden-touch',
        esGt: true,
        facturasBuzon: [],
        facturasCompras: [fc],
        pendientesOrdenes: [ordenItem],
        registradas: registradasVacias,
        practica: practicaDefecto,
      });

      expect(cola).toHaveLength(1);
      expect(cola[0].origen).toBe('compras_archivo');
      expect(cola[0].id).toBe(`compras-${fc.adjuntoId}`);
    });
  });

  describe('Filtro por estatus de Buzón', () => {
    it('solo incluye facturas de buzón con estatus recibida o en_revision', () => {
      const recibida = mockBuzon('b-recibida', { estatus: 'recibida' });
      const enRevision = mockBuzon('b-revision', { estatus: 'en_revision' });
      const retenida = mockBuzon('b-retenida', { estatus: 'retenida' });
      const descartada = mockBuzon('b-descartada', { estatus: 'descartada' });

      const cola = construirColaPorHacer({
        empresaId: 'empresa-golden-touch',
        esGt: true,
        facturasBuzon: [recibida, enRevision, retenida, descartada],
        facturasCompras: [],
        pendientesOrdenes: [],
        registradas: registradasVacias,
        practica: practicaDefecto,
      });

      const ids = cola.map((x) => x.id);
      expect(ids).toContain('buzon-b-recibida');
      expect(ids).toContain('buzon-b-revision');
      expect(ids).not.toContain('buzon-b-retenida');
      expect(ids).not.toContain('buzon-b-descartada');
    });
  });
});

