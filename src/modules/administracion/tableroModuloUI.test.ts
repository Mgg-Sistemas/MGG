import { describe, it, expect } from 'vitest';
import { colorSemaforoCobertura } from './administracionTableroModulo';

describe('colorSemaforoCobertura', () => {
  it('100% al día, 60-99 atención, <60 crítico', () => {
    expect(colorSemaforoCobertura(100)).toBe('al_dia');
    expect(colorSemaforoCobertura(80)).toBe('atencion');
    expect(colorSemaforoCobertura(59)).toBe('critico');
    expect(colorSemaforoCobertura(0)).toBe('critico');
  });
});
