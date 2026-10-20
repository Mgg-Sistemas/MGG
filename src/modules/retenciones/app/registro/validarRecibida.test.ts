import { describe, expect, it } from 'vitest';
import { avisoMonto, sugerenciaMonto, validarRecibida, type FormRecibida } from './validarRecibida';

// Datos inventados.
const ok: FormRecibida = {
  tipo: 'iva', cliente: 'Cliente de Prueba C.A.', rif: 'J-12345678-4', numero: '20261000000123', factura: '000502', control: '00-000502',
  fecha: '2026-10-07', moneda: 'Bs', base: '10000', iva: '1600', pct: '75', monto: '1200', observacion: '', archivo: null,
};
const HOY = '2026-10-20';

describe('una retención recibida (la que nos practica un cliente)', () => {
  it('completa y bien formada, sin errores', () => {
    expect(validarRecibida(ok, HOY)).toEqual({});
  });

  it('el comprobante de IVA tiene 14 dígitos; el de ISLR, un texto de hasta 20', () => {
    expect(validarRecibida({ ...ok, numero: '1234' }, HOY).numero).toContain('14 dígitos');
    expect(validarRecibida({ ...ok, tipo: 'islr', numero: '0000000977' }, HOY).numero).toBeUndefined();
  });

  it('sin cliente, RIF, factura, fecha o monto: dice cuál falta', () => {
    const e = validarRecibida({ ...ok, cliente: '', rif: '', factura: '', fecha: '', monto: '' }, HOY);
    expect(e.cliente).toContain('cliente');
    expect(e.rif).toBe('Indique el RIF del cliente.');
    expect(e.factura).toContain('factura de venta');
    expect(e.fecha).toContain('fecha');
    expect(e.monto).toContain('monto retenido');
  });

  it('una fecha futura o un % fuera de rango no pasan', () => {
    expect(validarRecibida({ ...ok, fecha: '2026-12-01' }, HOY).fecha).toContain('posterior a hoy');
    expect(validarRecibida({ ...ok, pct: '120' }, HOY).pct).toContain('hasta 100');
  });

  it('el monto no se rellena solo: se sugiere y, si no coincide con la cuenta, se avisa sin bloquear', () => {
    expect(sugerenciaMonto(ok)).toBe(1200);
    expect(sugerenciaMonto({ ...ok, tipo: 'islr', base: '50000', pct: '2' })).toBe(1000);
    expect(avisoMonto(ok)).toBeNull();
    expect(avisoMonto({ ...ok, monto: '1100' })).toContain('no coincide');
    expect(validarRecibida({ ...ok, monto: '1100' }, HOY).monto).toBeUndefined();
  });
});
