import { describe, it, expect } from 'vitest';
import { separarReembolso, aPagarConRetencion, conceptoReembolsoOc } from './reembolsoPago';

describe('pago de OC · retención', () => {
  it('la retención se resta del total de la factura', () => {
    expect(aPagarConRetencion(200, 15)).toBe(185);
  });
  it('sin retención se paga el total, y nunca queda negativo', () => {
    expect(aPagarConRetencion(200, 0)).toBe(200);
    expect(aPagarConRetencion(200, 250)).toBe(0);
  });
});

describe('pago de OC · reembolso de lo pagado de más', () => {
  it('factura de 200 pagada con 300 en una sola cuenta: 200 de pago y 100 de reembolso', () => {
    const r = separarReembolso([{ moneda: 'USDT', monto: 300, montoUsd: 300 }], 100);
    expect(r.pago).toEqual([{ moneda: 'USDT', monto: 200, montoUsd: 200 }]);
    expect(r.reembolso).toEqual([{ moneda: 'USDT', monto: 100, montoUsd: 100 }]);
  });

  it('el reembolso sale de la última cuenta y respeta su moneda', () => {
    const r = separarReembolso([
      { moneda: 'USD', monto: 150, montoUsd: 150 },
      { moneda: 'Bs', monto: 15000, montoUsd: 150 },   // tasa 100
    ], 100);
    expect(r.pago).toEqual([
      { moneda: 'USD', monto: 150, montoUsd: 150 },
      { moneda: 'Bs', monto: 5000, montoUsd: 50 },
    ]);
    expect(r.reembolso).toEqual([{ moneda: 'Bs', monto: 10000, montoUsd: 100 }]);
  });

  it('si el excedente pasa una cuenta entera, sigue con la anterior', () => {
    const r = separarReembolso([
      { moneda: 'USD', monto: 250, montoUsd: 250 },
      { moneda: 'USDT', monto: 50, montoUsd: 50 },
    ], 100);
    expect(r.pago).toEqual([{ moneda: 'USD', monto: 200, montoUsd: 200 }]);
    expect(r.reembolso).toEqual([
      { moneda: 'USD', monto: 50, montoUsd: 50 },
      { moneda: 'USDT', monto: 50, montoUsd: 50 },
    ]);
  });

  it('sin excedente no hay reembolso', () => {
    const r = separarReembolso([{ monto: 200, montoUsd: 200 }], 0);
    expect(r.reembolso).toEqual([]);
    expect(r.pago).toEqual([{ monto: 200, montoUsd: 200 }]);
  });

  it('el concepto nombra la orden de compra', () => {
    expect(conceptoReembolsoOc('OC-2026-0024')).toBe('REEMBOLSO DE ORDEN DE COMPRA OC-2026-0024');
  });
});
