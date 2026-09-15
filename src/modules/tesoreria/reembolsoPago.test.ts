import { describe, it, expect } from 'vitest';
import { separarReembolso, aPagarConRetencion, camposPagoDirecto, conceptoReembolsoDirecto, conceptoReembolsoOc, convertirRetencion } from './reembolsoPago';

describe('pago de OC · retención', () => {
  it('la retención se resta del total de la factura', () => {
    expect(aPagarConRetencion(200, 15)).toBe(185);
  });
  it('sin retención se paga el total, y nunca queda negativo', () => {
    expect(aPagarConRetencion(200, 0)).toBe(200);
    expect(aPagarConRetencion(200, 250)).toBe(0);
  });
});

describe('pago de OC · retención en Bs ⇄ $', () => {
  it('escrita en Bs, sale en $ con la tasa', () => {
    expect(convertirRetencion(3650, 'bs', 36.5)).toEqual({ bs: 3650, usd: 100 });
  });
  it('escrita en $, sale en Bs con la tasa', () => {
    expect(convertirRetencion(100, 'usd', 36.5)).toEqual({ bs: 3650, usd: 100 });
  });
  it('sin tasa no inventa la otra moneda', () => {
    expect(convertirRetencion(3650, 'bs', 0)).toEqual({ bs: 3650, usd: 0 });
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

  it('guarda la retención con su detalle y el reembolso en la moneda del directo', () => {
    expect(camposPagoDirecto(1600, { bs: 1600, usd: 10, tasa: 160 }, 25, 'Bs')).toEqual({
      ret_pago_monto: 1600, ret_pago_bs: 1600, ret_pago_usd: 10, ret_pago_tasa: 160,
      reembolso_monto: 25, reembolso_moneda: 'Bs',
    });
  });

  it('sin retención ni reembolso deja ceros y sin detalle', () => {
    expect(camposPagoDirecto(0, { bs: 5, usd: 1, tasa: 5 }, null, 'USD')).toEqual({
      ret_pago_monto: 0, ret_pago_bs: null, ret_pago_usd: null, ret_pago_tasa: null,
      reembolso_monto: 0, reembolso_moneda: null,
    });
  });

  it('una orden de servicio no se llama «orden de compra»', () => {
    expect(conceptoReembolsoOc('SV-2026-0007', null, 'servicio')).toBe('REEMBOLSO DE ORDEN DE SERVICIO SV-2026-0007');
  });

  it('el concepto de un directo dice si es compra o servicio', () => {
    expect(conceptoReembolsoDirecto('compra', 'CD-2026-0101')).toBe('REEMBOLSO DE COMPRA DIRECTA CD-2026-0101');
    expect(conceptoReembolsoDirecto('servicio', 'SD-2026-0033', 'Bs')).toBe('REEMBOLSO DE SERVICIO DIRECTO SD-2026-0033 · Bs');
  });
});
