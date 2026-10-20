import { describe, expect, it } from 'vitest';
import { paginarRelacion, partirEnPaginas } from './paginar';

describe('los cortes de página de las relaciones (maqueta v8-16, v8PaginasRelacion)', () => {
  it('reparte las filas por altura, con la cabecera fija en cada página', () => {
    // página de 100, cabecera de 40: caben 60 de filas
    expect(partirEnPaginas([20, 20, 20, 20, 30], 100, 40)).toEqual([[0, 1, 2], [3, 4]]);
  });

  it('una fila más alta que la página igual va (no deja páginas vacías en medio)', () => {
    expect(partirEnPaginas([200, 10], 100, 40)).toEqual([[0], [1]]);
  });

  it('sin filas, una página vacía', () => {
    expect(partirEnPaginas([], 100, 40)).toEqual([[]]);
  });

  it('las dos hojas de columnas cortan igual, con la fila más alta de las dos, y los totales al final', () => {
    const p = paginarRelacion({ fijo: [40, 40], filas: [[20, 20, 20], [20, 34, 20]], total: [20, 20] }, 100);
    expect(p.alturas).toEqual([20, 34, 20]);
    expect(p.grupos).toBe(2);
    // 20 + 34 = 54 cabe en 60; + 20 = 74 no: corta; la última página lleva la fila y los totales
    expect(p.paginas).toEqual([
      { grupo: 0, filas: [0, 1], conTotal: false }, { grupo: 0, filas: [2], conTotal: true },
      { grupo: 1, filas: [0, 1], conTotal: false }, { grupo: 1, filas: [2], conTotal: true },
    ]);
  });
});
