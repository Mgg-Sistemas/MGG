import { describe, it, expect } from 'vitest';
import {
  EMPRESA_POR_DEFECTO,
  MGG,
  definicionEmpresa,
  normalizarEmpresa,
} from './empresa';

/* Quedó UNA sola nómina. Estas pruebas no celebran que MGG sea MGG: fijan que
   cualquier resto de la época de las dos nóminas —una fila que todavía diga
   GOMETAL, una sin empresa— caiga del lado de MGG y no rompa ninguna pantalla. */

describe('la empresa de la nómina', () => {
  it('la empresa por defecto es MGG', () => {
    expect(EMPRESA_POR_DEFECTO).toBe('MGG');
  });

  it('la definición trae la razón social que va en los PDF', () => {
    expect(MGG.razonSocial).toBe('Mineral Group Guayana C.A.');
    expect(MGG.label).toBe('MGG');
  });

  it('definicionEmpresa devuelve MGG sin importar qué se le pase', () => {
    expect(definicionEmpresa().key).toBe('MGG');
    expect(definicionEmpresa('MGG').key).toBe('MGG');
    // Una ficha vieja de cuando existía la segunda nómina.
    expect(definicionEmpresa('GOMETAL').key).toBe('MGG');
    expect(definicionEmpresa(null).key).toBe('MGG');
  });

  it('normaliza a MGG lo que venga de la base', () => {
    expect(normalizarEmpresa('MGG')).toBe('MGG');
    expect(normalizarEmpresa('GOMETAL')).toBe('MGG');
    expect(normalizarEmpresa('gometal')).toBe('MGG');
    expect(normalizarEmpresa('GM')).toBe('MGG');
    expect(normalizarEmpresa(null)).toBe('MGG');
    expect(normalizarEmpresa(undefined)).toBe('MGG');
    expect(normalizarEmpresa('')).toBe('MGG');
    expect(normalizarEmpresa(123)).toBe('MGG');
  });
});
