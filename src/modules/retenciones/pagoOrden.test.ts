import { describe, it, expect } from 'vitest';
import { netoPagadoOc } from './pagoOrden.repository';

describe('netoPagadoOc', () => {
  it('suma los pago_oc de una sola moneda', () => {
    expect(netoPagadoOc([
      { monto: 100, moneda: 'Bs', categoria: 'pago_oc' },
      { monto: 50, moneda: 'Bs', categoria: 'pago_oc' },
    ])).toEqual({ monto: 150, moneda: 'Bs' });
  });

  it('ignora el excedente reembolso_oc', () => {
    expect(netoPagadoOc([
      { monto: 200, moneda: 'Bs', categoria: 'pago_oc' },
      { monto: 100, moneda: 'Bs', categoria: 'reembolso_oc' },
    ])).toEqual({ monto: 200, moneda: 'Bs' });
  });

  it('multimoneda → null (no se puede dar un monto fiable)', () => {
    expect(netoPagadoOc([
      { monto: 100, moneda: 'Bs', categoria: 'pago_oc' },
      { monto: 10, moneda: 'USD', categoria: 'pago_oc' },
    ])).toBeNull();
  });

  it('sin egresos de pago → null', () => {
    expect(netoPagadoOc([])).toBeNull();
    expect(netoPagadoOc([{ monto: 100, moneda: 'Bs', categoria: 'reembolso_oc' }])).toBeNull();
  });

  it('redondea a 2 decimales', () => {
    expect(netoPagadoOc([{ monto: 33.333, moneda: 'USD', categoria: 'pago_oc' }])).toEqual({ monto: 33.33, moneda: 'USD' });
  });
});
