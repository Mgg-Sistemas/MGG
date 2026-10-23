import { describe, expect, it } from 'vitest';
import { escalaPara } from './useAncho';

describe('la escala de la hoja en la vista previa (maqueta v8AjustarEscalaVista)', () => {
  it('en un escritorio ancho, a tamaño real (nunca agranda)', () => {
    expect(escalaPara(1400, 1056)).toBe(1);
  });
  it('en el teléfono (390 px), reducida para que la hoja entera se vea', () => {
    expect(escalaPara(390, 1056)).toBeCloseTo((390 - 16) / 1056, 5);
  });
  it('nunca menos de 0,2', () => {
    expect(escalaPara(50, 1056)).toBe(0.2);
  });
});
