import { describe, expect, it } from 'vitest';
import {
  semillaFacturaDesdeBuzon, semillaFacturaDesdeOrdenArchivo, semillaRetencionDesdeOrden,
} from './semillasRetencion';
import type { FacturaBuzon } from '@/modules/retenciones/facturasBuzon.repository';
import type { FacturaDeOrigen } from './documentosOrigen.repository';
import type { RetencionItem } from '@/modules/retenciones/retenciones.repository';

const buzon = {
  tipoDocumento: 'factura', proveedorNombre: 'Minera Uno', proveedorRif: 'J123456789',
  facturaNumero: 'F-001', facturaControl: 'C-001', facturaFecha: '2026-11-02',
  montoTotal: 1200, moneda: 'USD',
} as unknown as FacturaBuzon;

const archivo = {
  nombre: 'factura.pdf', bucket: 'adjuntos', path: 'oc/1/factura.pdf', adjuntoId: 'adj-1',
  origen: { tipo: 'oc', id: 'orden-1' },
} as unknown as FacturaDeOrigen;

const item = {
  proveedorNombre: 'Minera Uno',
  orden: {
    id: 'orden-1', oc_codigo: 'OC-001', codigo: 'OC-001', proveedor_id: 'prov-1',
    total_moneda: 'Bs', total: 1000, iva_monto: 160, igtf_monto: 0,
  },
} as unknown as RetencionItem;

describe('semillas del registro de retenciones', () => {
  it('el buzón siembra la factura con su empresa y su propio RIF', () => {
    expect(semillaFacturaDesdeBuzon(buzon, 'prov-1')).toMatchObject({
      direccion: 'practicada', contraparteId: 'prov-1', contraparteRif: 'J123456789',
      facturaNro: 'F-001', facturaTotal: 1200, baseImponible: 1200, moneda: 'USD',
    });
  });

  it('el archivo de Compras conserva el adjunto y el docId de la orden', () => {
    expect(semillaFacturaDesdeOrdenArchivo(archivo, item)).toMatchObject({
      docKind: 'oc', docId: 'orden-1', adjuntoId: 'adj-1',
      contraparteId: 'prov-1', baseImponible: 840, iva: 160,
    });
  });

  it('la orden histórica va como retención suelta y respeta el primer pendiente', () => {
    expect(semillaRetencionDesdeOrden(item, ['islr', 'iva'])).toMatchObject({
      direccion: 'practicada', tipoInicial: 'islr', docKind: 'oc', docId: 'orden-1',
      codigo: 'OC-001', total: 1000, baseImponible: 840,
    });
  });

  it('sin orden, la semilla suelta sigue siendo válida', () => {
    expect(semillaRetencionDesdeOrden({ proveedorNombre: 'X' } as unknown as RetencionItem, []))
      .toMatchObject({ direccion: 'practicada', tipoInicial: 'iva' });
  });
});
