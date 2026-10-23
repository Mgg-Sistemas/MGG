import { describe, it, expect } from 'vitest';
import { normalizarCodigoActividad, etiquetaActividad, textoActividad, ordenarActividades, validarActividadNueva, type ActividadEconomica } from './actividadesEconomicas';

const L: ActividadEconomica[] = [
  { codigo: '7412', descripcion: 'Contabilidad', tipo: 'actividad', activa: true },
  { codigo: '5000-5299', descripcion: 'Comercio', tipo: 'seccion', activa: true },
  { codigo: '5110', descripcion: 'Comercio al por mayor', tipo: 'actividad', activa: true },
];

describe('actividad económica CIIU (14/10/2026)', () => {
  it('normaliza códigos y rangos', () => {
    expect(normalizarCodigoActividad(' 0100 - 0299 ')).toBe('0100-0299');
    expect(normalizarCodigoActividad('5110')).toBe('5110');
    expect(normalizarCodigoActividad('51A0')).toBeNull();
    expect(normalizarCodigoActividad('1')).toBeNull();
  });

  it('etiqueta, texto y orden por código', () => {
    expect(etiquetaActividad(L[1])).toBe('Sección 5000-5299 · Comercio');
    expect(textoActividad('5110', L)).toBe('5110 · Comercio al por mayor');
    expect(textoActividad('9999', L)).toBe('9999');
    expect(textoActividad(null, L)).toBe('—');
    expect(ordenarActividades(L).map((a) => a.codigo)).toEqual(['5000-5299', '5110', '7412']);
  });

  it('valida la actividad nueva', () => {
    expect(validarActividadNueva('5110', 'Otra', L)).toMatch(/ya existe/);
    expect(validarActividadNueva('x', 'Algo', L)).toMatch(/dígitos/);
    expect(validarActividadNueva('7494', 'ab', L)).toMatch(/descripción/);
    expect(validarActividadNueva('7494', 'Fotografía', L)).toBeNull();
  });
});
