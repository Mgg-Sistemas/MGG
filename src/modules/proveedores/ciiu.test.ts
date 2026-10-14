import { describe, it, expect } from 'vitest';
import {
  codigoCiiuValido, esSeccion, etiquetaActividad, normalizarCodigoCiiu, opcionesActividades,
  seccionDeCodigo, textoActividad, validarActividadNueva, type ActividadEconomica,
} from './ciiu';

const LISTA: ActividadEconomica[] = [
  { codigo: '5000-5299', descripcion: 'Comercio al por Mayor y al por Menor; Reparación de Vehículos', activa: true },
  { codigo: '7220', descripcion: 'Consultores en programas de informática', activa: true },
  { codigo: '5110', descripcion: 'Comercio al por mayor a cambio de una retribución o por contrata', activa: true },
  { codigo: '9999', descripcion: 'Vieja', activa: false },
];

describe('actividad económica (CIIU) · 14-10-2026', () => {
  it('normaliza el código: dígitos, relleno a 4, rangos', () => {
    expect(normalizarCodigoCiiu('5110')).toBe('5110');
    expect(normalizarCodigoCiiu(' 511 ')).toBe('511');
    expect(normalizarCodigoCiiu('4500-4599')).toBe('4500-4599');
    expect(normalizarCodigoCiiu('45a00')).toBe('4500');
    expect(normalizarCodigoCiiu(null)).toBe('');
    expect(codigoCiiuValido('5110')).toBe(true);
    expect(codigoCiiuValido('511')).toBe(false);
    expect(codigoCiiuValido('5000-5299')).toBe(true);
    expect(esSeccion('5000-5299')).toBe(true);
    expect(esSeccion('5110')).toBe(false);
  });

  it('ubica la sección CIIU de un código', () => {
    expect(seccionDeCodigo('5110')).toMatch(/Comercio/);
    expect(seccionDeCodigo('7220')).toMatch(/Empresariales/);
    expect(seccionDeCodigo('4500-4599')).toBe('Construcción');
    expect(seccionDeCodigo('0450')).toBeNull();
  });

  it('escribe «código · descripción» y resuelve un código guardado', () => {
    expect(etiquetaActividad(LISTA[1])).toBe('7220 · Consultores en programas de informática');
    expect(textoActividad('7220', LISTA)).toBe('7220 · Consultores en programas de informática');
    expect(textoActividad('1234', LISTA)).toBe('1234');
    expect(textoActividad(null, LISTA)).toBe('');
  });

  it('opciones: puntuales primero, secciones después, sin las inactivas salvo la elegida', () => {
    expect(opcionesActividades(LISTA).map((o) => o.value)).toEqual(['5110', '7220', '5000-5299']);
    expect(opcionesActividades(LISTA, '9999').map((o) => o.value)).toEqual(['5110', '7220', '9999', '5000-5299']);
    const o = opcionesActividades(LISTA)[0];
    expect(o.keywords).toContain('5110');
    expect(o.hint).toMatch(/Comercio/);
    expect(opcionesActividades(LISTA)[2].hint).toBe('Sección CIIU');
  });

  it('valida la actividad nueva: código, repetidos y descripción', () => {
    expect(validarActividadNueva('4520', 'Construcción de edificios', LISTA)).toBeNull();
    expect(validarActividadNueva('45', 'x', LISTA)).toMatch(/4 dígitos/);
    expect(validarActividadNueva('5110', 'Otra', LISTA)).toMatch(/ya está/);
    expect(validarActividadNueva('4520', 'ab', LISTA)).toMatch(/descripción/);
  });
});
