import { describe, it, expect } from 'vitest';
import {
  kgDeEscoria, ingresaEscoria, detalleEscoria, detalleEscoriaRefinacion,
  NOMBRE_ESCORIA, NOMBRE_ESCORIA_REFINACION, CATEGORIA_ESCORIA,
} from './escoriaFundicion';

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

  it('el kardex dice de qué refinación vino el dross', () => {
    expect(detalleEscoriaRefinacion(3)).toContain('refinación N° 3');
    expect(detalleEscoriaRefinacion(null)).toContain('una refinación');
  });

  it('la ficha vive con la casiterita, para poder volver a fundirla', () => {
    expect(NOMBRE_ESCORIA).toBe('ESCOREA DE FUNDICION');
    // MINERALES es la categoría real del catálogo (la de ESCOREA DE CASITERITA).
    // Antes decía 'MP', que no existe: la ficha habría nacido en una categoría
    // fantasma, fuera de los filtros del inventario.
    expect(CATEGORIA_ESCORIA).toBe('MINERALES');
  });

  it('el horno y la olla no comparten ficha', () => {
    // Leyes de Sn muy distintas: mezclarlas rompe el reporte de recuperación.
    expect(NOMBRE_ESCORIA_REFINACION).toBe('ESCOREA DE REFINACION');
    expect(NOMBRE_ESCORIA_REFINACION).not.toBe(NOMBRE_ESCORIA);
  });
});
