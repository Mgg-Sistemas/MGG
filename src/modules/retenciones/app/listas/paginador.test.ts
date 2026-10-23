import { describe, expect, it } from 'vitest';
import {
  acotarPagina, avisoFilas, avisoIrPagina, destinoDeshabilitado, leerIrPagina, mostrarSelectorFilas,
  numeroDePaginas, numerosPagina, paginar, rangoVisible, textoMostrando,
} from './paginador';

describe('el paginador numerado (R3-3): los números con elipsis', () => {
  it('en la primera de 150: 1 2 3 4 … 150 (como la maqueta con el volumen)', () => {
    expect(numerosPagina(1, 150)).toEqual([1, 2, 3, 4, '…', 150]);
  });

  it('en una página del medio: la primera, la actual con sus vecinas y la última', () => {
    expect(numerosPagina(23, 150)).toEqual([1, '…', 22, 23, 24, '…', 150]);
  });

  it('en la última: las cuatro últimas', () => {
    expect(numerosPagina(150, 150)).toEqual([1, '…', 147, 148, 149, 150]);
    expect(numerosPagina(148, 150)).toEqual([1, '…', 147, 148, 149, 150]);
  });

  it('cerca del principio no deja huecos: 1 2 3 4 … y la última', () => {
    expect(numerosPagina(3, 150)).toEqual([1, 2, 3, 4, '…', 150]);
    expect(numerosPagina(4, 150)).toEqual([1, '…', 3, 4, 5, '…', 150]);
  });

  it('con pocas páginas, todas, sin elipsis', () => {
    expect(numerosPagina(1, 1)).toEqual([1]);
    expect(numerosPagina(2, 3)).toEqual([1, 2, 3]);
    expect(numerosPagina(3, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it('nunca repite un número ni pone dos elipsis seguidas', () => {
    for (let n = 1; n <= 40; n++) {
      for (let p = 1; p <= n; p++) {
        const xs = numerosPagina(p, n);
        const nums = xs.filter((x) => x !== '…') as number[];
        expect(new Set(nums).size).toBe(nums.length);
        expect(nums[0]).toBe(1);
        expect(nums[nums.length - 1]).toBe(n);
        expect(nums).toContain(p);
        xs.forEach((x, i) => { if (x === '…') expect(xs[i + 1]).not.toBe('…'); });
      }
    }
  });

  it('una página fuera de rango se acota', () => {
    expect(numerosPagina(0, 10)).toEqual(numerosPagina(1, 10));
    expect(numerosPagina(99, 10)).toEqual(numerosPagina(10, 10));
    expect(acotarPagina(-3, 7)).toBe(1);
    expect(acotarPagina(8, 7)).toBe(7);
  });
});

describe('el paginador: «Mostrando X–Y de N», páginas y filas', () => {
  it('cuenta las páginas (al menos una)', () => {
    expect(numeroDePaginas(0, 25)).toBe(1);
    expect(numeroDePaginas(25, 25)).toBe(1);
    expect(numeroDePaginas(26, 25)).toBe(2);
    expect(numeroDePaginas(3730, 25)).toBe(150);
  });

  it('dice qué filas se ven, con los miles con punto', () => {
    expect(textoMostrando(3730, 23, 25)).toBe('Mostrando 551–575 de 3.730');
    expect(textoMostrando(3730, 150, 25)).toBe('Mostrando 3.726–3.730 de 3.730');
    expect(textoMostrando(11, 1, 25)).toBe('Mostrando 1–11 de 11');
    expect(textoMostrando(0, 1, 25)).toBe('Sin resultados');
    expect(rangoVisible(0, 1, 25)).toEqual({ desde: 0, hasta: 0 });
  });

  it('pagina una lista y acota la página pedida', () => {
    const xs = Array.from({ length: 60 }, (_, i) => i + 1);
    expect(paginar(xs, 2, 25)).toEqual({ filas: xs.slice(25, 50), pagina: 2, paginas: 3 });
    expect(paginar(xs, 9, 25).pagina).toBe(3);
    expect(paginar(xs, 9, 25).filas).toEqual([51, 52, 53, 54, 55, 56, 57, 58, 59, 60]);
    expect(paginar([], 4, 25)).toEqual({ filas: [], pagina: 1, paginas: 1 });
  });

  it('los botones no llevan fuera de 1…n ni a la página actual', () => {
    expect(destinoDeshabilitado(0, 1, 5)).toBe(true);
    expect(destinoDeshabilitado(1, 1, 5)).toBe(true);
    expect(destinoDeshabilitado(2, 1, 5)).toBe(false);
    expect(destinoDeshabilitado(6, 5, 5)).toBe(true);
  });

  it('«Ir a la página» acepta 1…n y avisa si no', () => {
    expect(leerIrPagina('23', 150)).toBe(23);
    expect(leerIrPagina('22.6', 150)).toBe(23);
    expect(leerIrPagina('0', 150)).toBeNull();
    expect(leerIrPagina('151', 150)).toBeNull();
    expect(leerIrPagina('', 150)).toBeNull();
    expect(leerIrPagina('abc', 150)).toBeNull();
    expect(avisoIrPagina(1500)).toBe('Indique una página entre 1 y 1.500.');
  });

  it('el selector de filas (25/50/100) solo aparece si hay más filas que el menor tamaño', () => {
    expect(mostrarSelectorFilas(25, 25)).toBe(false);
    expect(mostrarSelectorFilas(25, 26)).toBe(true);
    expect(mostrarSelectorFilas(50, 30)).toBe(true);
    expect(mostrarSelectorFilas(10, 300)).toBe(false);
    expect(avisoFilas(50)).toBe('50 filas por página en todas las listas.');
  });
});
