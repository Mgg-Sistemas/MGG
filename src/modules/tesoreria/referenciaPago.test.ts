import { describe, expect, it } from 'vitest';
import { errorReferencia, limpiarReferencia, referenciasRequeridas, soloDigitos, textoReferencia } from './referenciaPago';
import { tieneMetodoPagoCargado } from '@/modules/pedidos/pedidos.repository';
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

  it('exige exactamente 4 dígitos en Bs y 4 caracteres alfanuméricos en Binance (permite letras)', () => {
    expect(errorReferencia('1234', 'bs')).toBeNull();
    expect(errorReferencia(' 12-34 ', 'binance')).toBeNull();
    // Binance admite letras y números (se normalizan en mayúsculas sin espacios/guiones)
    expect(errorReferencia('ab12', 'binance')).toBeNull();
    expect(errorReferencia('3F9a', 'binance')).toBeNull();
    expect(limpiarReferencia('3f-9a', 'binance')).toBe('3F9A');
    // Bs solo admite dígitos (ignora letras)
    expect(limpiarReferencia('ab9-8 7x6', 'bs')).toBe('9876');
    expect(errorReferencia('', 'bs')).toMatch(/últimos 4 dígitos/);
    expect(errorReferencia('123', 'binance')).toMatch(/cargaste 3/);
    expect(errorReferencia('12345', 'bs')).toMatch(/cargaste 5/);
    expect(errorReferencia('ABCDE', 'binance')).toMatch(/cargaste 5/);
    expect(soloDigitos('ab9-8 7x6')).toBe('9876');
  });

  it('el concepto del movimiento lleva la referencia de su moneda', () => {
    const refs = { bs: '4821', binance: '7730' };
    expect(textoReferencia('Bs', refs)).toBe('ref. …4821');
    expect(textoReferencia('USDT', refs)).toBe('Binance orden …7730');
    expect(textoReferencia('USD', { bs: '4821' })).toBe('');
    expect(textoReferencia('Bs', null)).toBe('');
  });

  it('tieneMetodoPagoCargado solo aprueba OC con estado distinto a confirmada_metodo y con método de pago cargado', () => {
    // 1. En confirmada_metodo aún Compras no cargó el método
    expect(tieneMetodoPagoCargado({ orden: { estado: 'confirmada_metodo', metodo_pago: [] }, esperandoMetodo: true })).toBe(false);
    expect(tieneMetodoPagoCargado({ orden: { estado: 'confirmada_metodo', metodo_pago: [{ metodo: 'binance_usdt', moneda: 'USDT', monto: 100 }] }, esperandoMetodo: false })).toBe(false);

    // 2. Con esperandoMetodo = true
    expect(tieneMetodoPagoCargado({ orden: { estado: 'oc_aprobada', metodo_pago: [] }, esperandoMetodo: true })).toBe(false);

    // 3. Sin método de pago cargado
    expect(tieneMetodoPagoCargado({ orden: { estado: 'oc_aprobada', metodo_pago: [] }, esperandoMetodo: false })).toBe(false);
    expect(tieneMetodoPagoCargado({ orden: { estado: 'oc_aprobada', metodo_pago: null }, esperandoMetodo: false })).toBe(false);

    // 4. Con método de pago cargado desde compras y aprobada para pagar
    expect(tieneMetodoPagoCargado({
      orden: { estado: 'oc_aprobada', metodo_pago: [{ metodo: 'binance_usdt', moneda: 'USDT', monto: 100 }] },
      esperandoMetodo: false,
    })).toBe(true);
  });
});
