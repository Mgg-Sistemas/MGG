import { describe, expect, it } from 'vitest';
import type { Orden } from '@/shared/lib/types';
import { archivoDeFactura, origenFactura } from './facturaCompras';
import { cantidadFacturas } from './facturasOrden.repository';

const o = (p: Record<string, unknown>) => ({ id: 'o1', historial: [], pagada_en: '2026-11-01T15:00:00Z', ...p } as unknown as Orden);

describe('¿la factura de factura_path la cargó Compras?', () => {
  it('sin archivo: ninguno', () => {
    expect(origenFactura(o({ factura_path: null }))).toBe('ninguno');
  });
  it('desde hoy el historial lo dice (finalizar / reemplazar factura)', () => {
    expect(origenFactura(o({ factura_path: 'o1/factura-f.pdf', historial: [{ evento: 'finalizada', factura_path: 'o1/factura-f.pdf' }] }))).toBe('compras');
    expect(origenFactura(o({ factura_path: 'o1/factura-g.pdf', historial: [{ evento: 'factura_cargada', factura_path: 'o1/factura-g.pdf' }] }))).toBe('compras');
  });
  it('el comprobante del pago (historial o prefijo pago-) es de Tesorería', () => {
    expect(origenFactura(o({ factura_path: 'o1/factura-t.pdf', historial: [{ evento: 'pagada', comprobante_path: 'o1/factura-t.pdf' }] }))).toBe('tesoreria');
    expect(origenFactura(o({ factura_path: 'o1/pago-t.pdf' }))).toBe('tesoreria');
  });
  it('Tesorería anotó el suyo aparte → lo que quedó lo puso Compras; sin pago de Tesorería, también', () => {
    expect(origenFactura(o({ factura_path: 'o1/factura-f.pdf', historial: [{ evento: 'pagada', comprobante_path: 'o1/pago-t.pdf' }] }))).toBe('compras');
    expect(origenFactura(o({ factura_path: 'o1/factura-f.pdf', pagada_en: null }))).toBe('compras');
  });
  it('OC viejas: por la hora de subida (más de 5 min después del pago = Compras)', () => {
    const vieja = o({ factura_path: 'o1/factura-x.pdf' });
    expect(origenFactura(vieja)).toBe('desconocido');
    expect(origenFactura(vieja, { name: 'factura-x.pdf', created_at: '2026-11-01T15:02:00Z' })).toBe('tesoreria');
    expect(origenFactura(vieja, { name: 'factura-x.pdf', created_at: '2026-11-01T15:02:00Z', updated_at: '2026-11-03T10:00:00Z' })).toBe('compras');
    expect(archivoDeFactura(vieja, [{ name: 'otra.pdf' }, { name: 'factura-x.pdf' }])?.name).toBe('factura-x.pdf');
  });
  it('el conteo de facturas suma la de Compras', () => {
    const fin = o({ factura_path: 'o1/factura-f.pdf', historial: [{ evento: 'finalizada', factura_path: 'o1/factura-f.pdf' }], facturas_almacen: [{ path: 'a', filename: 'a' }] });
    expect(cantidadFacturas(fin)).toBe(2);
    expect(cantidadFacturas(o({ factura_path: 'o1/pago-t.pdf' }))).toBe(0);
    expect(cantidadFacturas(o({ factura_path: 'o1/factura-x.pdf' }), 'compras')).toBe(1);
  });
});
