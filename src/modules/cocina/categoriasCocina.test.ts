import { afterEach, describe, expect, it } from 'vitest';
import {
  CATEGORIAS_COCINA, CATEGORIAS_COMESTIBLES, aplicarCategoriasCocina, esCategoriaCocina, esComestible,
} from './categoriasCocina';

const respaldo = () => aplicarCategoriasCocina([
  ...CATEGORIAS_COMESTIBLES.map((categoria) => ({ categoria, tipo: 'comestible' as const, activa: true })),
  ...CATEGORIAS_COCINA.filter((c) => !CATEGORIAS_COMESTIBLES.includes(c)).map((categoria) => ({ categoria, tipo: 'limpieza' as const, activa: true })),
]);

describe('categorías de Cocina gestionables', () => {
  afterEach(respaldo);

  it('arranca con la lista de respaldo (sin tildes, sin S final)', () => {
    expect(esCategoriaCocina('Proteínas')).toBe(true);
    expect(esComestible('LIMPIEZA')).toBe(false);
    expect(esCategoriaCocina('LIMPIEZA')).toBe(true);
    expect(esCategoriaCocina('FERRETERIA')).toBe(false);
  });

  it('una categoría agregada entra; una pausada sale', () => {
    aplicarCategoriasCocina([
      { categoria: 'DESECHABLES', tipo: 'limpieza', activa: true },
      { categoria: 'VIVERES', tipo: 'comestible', activa: false },
      { categoria: 'PROTEINA', tipo: 'comestible', activa: true },
    ]);
    expect(esCategoriaCocina('Desechables')).toBe(true);
    expect(esComestible('DESECHABLES')).toBe(false);
    expect(esCategoriaCocina('VIVERES')).toBe(false);
    expect(esComestible('proteinas')).toBe(true);
  });

  it('cambiar el tipo cambia si la descuenta el plato', () => {
    aplicarCategoriasCocina([{ categoria: 'BEBIDAS', tipo: 'limpieza', activa: true }]);
    expect(esCategoriaCocina('BEBIDAS')).toBe(true);
    expect(esComestible('BEBIDAS')).toBe(false);
  });
});
