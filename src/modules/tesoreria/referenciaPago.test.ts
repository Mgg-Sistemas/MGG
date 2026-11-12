import { describe, expect, it } from 'vitest';
import { errorReferencia, referenciasRequeridas, soloDigitos, textoReferencia } from './referenciaPago';
import type { PagoMetodo } from '@/shared/lib/types';

const m = (...ms: string[]) => ms.map((metodo) => ({ metodo, moneda: '', monto: 0 })) as PagoMetodo[];
const soloBs = { bs: true, usdt: false, noBs: false };
const soloUsdt = { bs: false, usdt: true, noBs: true };
const soloUsd = { bs: false, usdt: false, noBs: true };

describe('referencia del pago de una OC (12-11-2026)', () => {
  it('pago en Bs por transferencia o pago móvil pide la referencia', () => {
    expect(referenciasRequeridas(m('pago_movil'), soloBs)).toEqual({ bs: true, binance: false });
    expect(referenciasRequeridas(m('transferencia'), soloBs)).toEqual({ bs: true, binance: false });
    // Sin método indicado (Tesorería paga directo): igual la pide.
    expect(referenciasRequeridas([], soloBs).bs).toBe(true);
  });

  it('el efectivo en Bs no lleva referencia', () => {
    expect(referenciasRequeridas(m('efectivo_bs'), soloBs).bs).toBe(false);
    // Si además hay pago móvil, sí.
    expect(referenciasRequeridas(m('efectivo_bs', 'pago_movil'), soloBs).bs).toBe(true);
  });

  it('Binance pide el ID de la orden: por la cuenta USDT o por el método indicado', () => {
    expect(referenciasRequeridas([], soloUsdt).binance).toBe(true);
    expect(referenciasRequeridas(m('binance_usdt'), soloUsd).binance).toBe(true);
    expect(referenciasRequeridas(m('divisas_efectivo'), soloUsd)).toEqual({ bs: false, binance: false });
  });

  it('multipago Bs + Binance pide las dos', () => {
    expect(referenciasRequeridas(m('pago_movil', 'binance_usdt'), { bs: true, usdt: true, noBs: true })).toEqual({ bs: true, binance: true });
  });

  it('exige exactamente 4 dígitos', () => {
    expect(errorReferencia('1234', 'bs')).toBeNull();
    expect(errorReferencia(' 12-34 ', 'binance')).toBeNull();
    expect(errorReferencia('', 'bs')).toMatch(/últimos 4 dígitos/);
    expect(errorReferencia('123', 'binance')).toMatch(/cargaste 3/);
    expect(errorReferencia('12345', 'bs')).toMatch(/cargaste 5/);
    expect(soloDigitos('ab9-8 7x6')).toBe('9876');
  });

  it('el concepto del movimiento lleva la referencia de su moneda', () => {
    const refs = { bs: '4821', binance: '7730' };
    expect(textoReferencia('Bs', refs)).toBe('ref. …4821');
    expect(textoReferencia('USDT', refs)).toBe('Binance orden …7730');
    expect(textoReferencia('USD', { bs: '4821' })).toBe('');
    expect(textoReferencia('Bs', null)).toBe('');
  });
});
