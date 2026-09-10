import { describe, it, expect } from 'vitest';
import { kgDeEscoria, ingresaEscoria, detalleEscoria, NOMBRE_ESCORIA, CATEGORIA_ESCORIA } from './escoriaFundicion';

describe('la escoria de una colada vuelve al inventario', () => {
  it('entra con los kg que se cargaron', () => {
    expect(kgDeEscoria(147.25)).toBe(147.25);
  });

  it('no entra nada si no hay dato, es cero o es negativo', () => {
    expect(kgDeEscoria(null)).toBe(0);
    expect(kgDeEscoria(undefined)).toBe(0);
    expect(kgDeEscoria(0)).toBe(0);
    expect(kgDeEscoria(-5)).toBe(0);
    expect(kgDeEscoria(Number.NaN)).toBe(0);
  });

  it('redondea al gramo, sin arrastrar decimales de coma flotante', () => {
    expect(kgDeEscoria(10.0000000004)).toBe(10);
    expect(kgDeEscoria(147.2549)).toBe(147.255);
  });

  it('una colada que no suma al inventario tampoco ingresa su escoria', () => {
    expect(ingresaEscoria(147.25, false)).toBe(false);
    expect(ingresaEscoria(147.25, true)).toBe(true);
    expect(ingresaEscoria(147.25, undefined)).toBe(true);
  });

  it('sin escoria no se registra un movimiento vacío', () => {
    expect(ingresaEscoria(0, true)).toBe(false);
    expect(ingresaEscoria(null, true)).toBe(false);
  });

  it('el kardex dice de qué colada vino', () => {
    expect(detalleEscoria(2)).toContain('colada N° 2');
    expect(detalleEscoria(null)).toContain('una colada');
  });

  it('la ficha es materia prima, para poder volver a fundirla', () => {
    expect(NOMBRE_ESCORIA).toBe('ESCOREA DE FUNDICION');
    expect(CATEGORIA_ESCORIA).toBe('MP');
  });
});
