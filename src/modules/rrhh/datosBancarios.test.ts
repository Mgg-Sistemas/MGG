import { describe, expect, it } from 'vitest';
import {
  DATOS_BANCARIOS_VACIOS, errorDatosBancarios, leerDatosBancarios, normalizarDatosBancarios, renglonesDatosBancarios,
} from './datosBancarios';

describe('datos bancarios del trabajador (03-11-2026)', () => {
  it('sin nada no guarda un objeto vacío', () => {
    expect(normalizarDatosBancarios(DATOS_BANCARIOS_VACIOS)).toBeNull();
    expect(leerDatosBancarios(null)).toEqual(DATOS_BANCARIOS_VACIOS);
  });

  it('limpia la cuenta y pone en mayúsculas la cédula y el titular', () => {
    const d = normalizarDatosBancarios({
      ...DATOS_BANCARIOS_VACIOS,
      transferencia: { banco: '0102', cuenta: '0102-0000-11-2222333344', titular: 'juan perez', cedula: 'v-12345678' },
    });
    expect(d?.transferencia).toEqual({ banco: '0102', cuenta: '01020000112222333344', titular: 'JUAN PEREZ', cedula: 'V-12345678' });
  });

  it('avisa la cuenta corta y el pago móvil a medias', () => {
    const base = { ...DATOS_BANCARIOS_VACIOS };
    expect(errorDatosBancarios({ ...base, transferencia: { ...base.transferencia, cuenta: '0102 1234' } })).toMatch(/20 dígitos/);
    expect(errorDatosBancarios({ ...base, pago_movil: { banco: '0105', telefono: '', cedula: '' } })).toMatch(/Pago móvil/);
    expect(errorDatosBancarios({ ...base, binance: 'juan_p' })).toBeNull();
  });

  it('arma los renglones de la ficha con lo que hay', () => {
    const r = renglonesDatosBancarios({
      pago_movil: { banco: '0105', telefono: '0414-1234567', cedula: 'V-1' },
      binance: 'juan_p', trc20: 'TXabc', tron: '',
    });
    expect(r).toEqual([
      ['Pago móvil (Bs)', '0105 · Mercantil · 0414-1234567 · V-1'],
      ['Binance (USDT)', 'juan_p'],
      ['USDT · red TRC20', 'TXabc'],
    ]);
  });
});
