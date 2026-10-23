import { describe, expect, it } from 'vitest';
import { completarRif, digitoVerificadorRif, formatearRif, rifValido } from './rif';

// RIF inventados. El dígito de V-12345678 se calculó a mano:
// 1·4 + (1·3 + 2·2 + 3·7 + 4·6 + 5·5 + 6·4 + 7·3 + 8·2) = 142; 142 mód 11 = 10; 11 − 10 = 1.
describe('dígito verificador del RIF', () => {
  it('coincide con el cálculo a mano', () => {
    expect(digitoVerificadorRif('V', '12345678')).toBe(1);
    expect(rifValido('V-12345678-1')).toBe(true);
    expect(rifValido('V-12345678-2')).toBe(false);
  });
});

describe('completarRif', () => {
  it('deja igual un RIF ya válido (normalizado)', () => {
    expect(completarRif('v-12345678-1')).toBe('V123456781');
  });

  it('calcula el dígito cuando faltan: letra y 8 números', () => {
    const r = completarRif('V-12345678');
    expect(r).toBe('V123456781');
    expect(formatearRif(r)).toBe('V-12345678-1');
    const j = completarRif('J-87654321');
    expect(j && rifValido(j)).toBe(true);
  });

  it('completa con ceros una cédula corta, como en el RIF de una persona', () => {
    const r = completarRif('V-1234567');
    expect(r?.slice(0, 9)).toBe('V01234567');
    expect(r && rifValido(r)).toBe(true);
  });

  it('no arregla lo que no tiene arreglo', () => {
    expect(completarRif('V-12345678-2')).toBeNull(); // 9 números con el dígito equivocado
    expect(completarRif('S/R')).toBeNull();
    expect(completarRif('X-12345678')).toBeNull();
    expect(completarRif('V-123456789012')).toBeNull();
    expect(completarRif('')).toBeNull();
  });
});
