import { describe, expect, it } from 'vitest';
import { limpiarMontoEs, montoAStrEs, parseMontoEs } from './montoEs';

describe('parseMontoEs · montos como se escriben en Venezuela', () => {
  it('coma decimal sin miles', () => {
    expect(parseMontoEs('12,5')).toBe(12.5);
    expect(parseMontoEs('1234,56')).toBe(1234.56);
    expect(parseMontoEs('0,48')).toBe(0.48);
    expect(parseMontoEs('0,')).toBe(0);
  });

  it('punto de miles y coma decimal (el caso que fallaba)', () => {
    expect(parseMontoEs('1.234,56')).toBe(1234.56);
    expect(parseMontoEs('2.500,00')).toBe(2500);
    expect(parseMontoEs('12.345.678,9')).toBe(12345678.9);
  });

  it('miles con punto y SIN decimales', () => {
    expect(parseMontoEs('2.500')).toBe(2500);
    expect(parseMontoEs('1.234.567')).toBe(1234567);
  });

  it('punto como decimal (teclado en inglés, o precios copiados)', () => {
    expect(parseMontoEs('6.5')).toBe(6.5);
    expect(parseMontoEs('0.48')).toBe(0.48);
    expect(parseMontoEs('1234.56')).toBe(1234.56);
    expect(parseMontoEs('0.125')).toBe(0.125);
  });

  it('formato inglés 1,234.56', () => {
    expect(parseMontoEs('1,234.56')).toBe(1234.56);
    expect(parseMontoEs('1,234,567')).toBe(1234567);
  });

  it('negativos (el ajuste frente a la factura lleva signo)', () => {
    expect(parseMontoEs('-1,5')).toBe(-1.5);
    expect(parseMontoEs('-1.234,56')).toBe(-1234.56);
  });

  it('vacío, espacios y basura valen 0', () => {
    expect(parseMontoEs('')).toBe(0);
    expect(parseMontoEs('   ')).toBe(0);
    expect(parseMontoEs('abc')).toBe(0);
    expect(parseMontoEs(null)).toBe(0);
    expect(parseMontoEs(undefined)).toBe(0);
    expect(parseMontoEs(' 1 234,5 ')).toBe(1234.5);
  });

  it('tipeando de a una tecla el resultado final es el mismo', () => {
    let txt = '';
    for (const ch of '1.234,56') txt = limpiarMontoEs(txt + ch);
    expect(txt).toBe('1.234,56');
    expect(parseMontoEs(txt)).toBe(1234.56);
  });
});

describe('limpiarMontoEs', () => {
  it('deja dígitos, punto y coma; quita lo demás', () => {
    expect(limpiarMontoEs('Bs 1.234,5x')).toBe('1.234,5');
  });
  it('permite el signo menos solo al inicio cuando se pide', () => {
    expect(limpiarMontoEs('-1,5', true)).toBe('-1,5');
    expect(limpiarMontoEs('1-5', true)).toBe('15');
    expect(limpiarMontoEs('-1,5')).toBe('1,5');
  });
  it('no toca los separadores: la lectura decide cuál es el decimal', () => {
    expect(limpiarMontoEs('1,2,3')).toBe('1,2,3');
  });
});

describe('montoAStrEs', () => {
  it('número → texto con coma decimal, vacío si es 0', () => {
    expect(montoAStrEs(6.5)).toBe('6,5');
    expect(montoAStrEs(2500)).toBe('2500');
    expect(montoAStrEs(0)).toBe('');
    expect(montoAStrEs(-1.5)).toBe('-1,5');
  });
  it('lo que muestra se lee de vuelta igual', () => {
    for (const n of [0.48, 6.5, 12.12, 2500, 1234.56, 99999.99, 0.125]) {
      expect(parseMontoEs(montoAStrEs(n))).toBe(n);
    }
  });
});
