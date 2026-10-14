import { describe, it, expect } from 'vitest';
import { normalizarRif, partirRif } from './rif';

describe('normalizarRif (una sola forma de guardar el RIF)', () => {
  it('deja LETRA-DÍGITOS sin puntos, guiones ni espacios', () => {
    expect(normalizarRif('J-12345678-9')).toBe('J-123456789');
    expect(normalizarRif('j 12.345.678 9')).toBe('J-123456789');
    expect(normalizarRif('V-27514395')).toBe('V-27514395');
    expect(normalizarRif('G200012345')).toBe('G-200012345');
  });
  it('sin letra asume J (empresa) y sin dígitos devuelve vacío', () => {
    expect(normalizarRif('123456789')).toBe('J-123456789');
    expect(normalizarRif('J-')).toBe('');
    expect(normalizarRif('')).toBe('');
    expect(normalizarRif(null)).toBe('');
  });
  it('coincide con partirRif', () => {
    const { letra, numero } = partirRif('v-27.514.395');
    expect(normalizarRif('v-27.514.395')).toBe(`${letra}-${numero}`);
  });
});
