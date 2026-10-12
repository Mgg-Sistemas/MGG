import { describe, it, expect } from 'vitest';
import { resumenSeleccion } from './MultiCheckFiltro';
import { pasaFiltroCategorias } from '@/modules/inventario/filtroCategorias';

describe('filtro de varias categorías (Inventario, 12-10-2026)', () => {
  it('sin nada marcado no filtra; con varias, pasa cualquiera de ellas', () => {
    expect(pasaFiltroCategorias([], 'COCINA')).toBe(true);
    expect(pasaFiltroCategorias([], null)).toBe(true);
    expect(pasaFiltroCategorias(['COCINA', 'LIMPIEZA'], 'COCINA')).toBe(true);
    expect(pasaFiltroCategorias(['COCINA', 'LIMPIEZA'], 'LIMPIEZA')).toBe(true);
    expect(pasaFiltroCategorias(['COCINA', 'LIMPIEZA'], 'EPP')).toBe(false);
    expect(pasaFiltroCategorias(['COCINA'], null)).toBe(false);
  });

  it('el control cerrado resume lo marcado', () => {
    expect(resumenSeleccion([], 'Todas las categorías')).toBe('Todas las categorías');
    expect(resumenSeleccion(['COCINA'], 'Todas las categorías')).toBe('COCINA');
    expect(resumenSeleccion(['COCINA', 'LIMPIEZA', 'EPP'], 'Todas las categorías')).toBe('COCINA +2');
  });
});
