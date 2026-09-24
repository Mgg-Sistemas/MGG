import { describe, it, expect } from 'vitest';
import { recorteKanban, TOPE_FINALIZADOS } from './topeKanban';

const lista = (n: number) => Array.from({ length: n }, (_, i) => `c${i + 1}`);

describe('el Kanban muestra las últimas y manda el resto a la Lista', () => {
  it('el tope son diez', () => {
    expect(TOPE_FINALIZADOS).toBe(10);
  });

  it('si entran todas, no ofrece el salto', () => {
    const r = recorteKanban(lista(3));
    expect(r.visibles).toHaveLength(3);
    expect(r.ocultas).toBe(0);
    expect(r.hayMas).toBe(false);
  });

  it('justo en el tope tampoco sobra ninguna', () => {
    const r = recorteKanban(lista(10));
    expect(r.visibles).toHaveLength(10);
    expect(r.ocultas).toBe(0);
    expect(r.hayMas).toBe(false);
  });

  it('pasado el tope recorta y dice cuántas quedaron fuera', () => {
    const r = recorteKanban(lista(48));
    expect(r.visibles).toHaveLength(10);
    expect(r.ocultas).toBe(38);
    expect(r.hayMas).toBe(true);
  });

  it('muestra las MÁS RECIENTES, que vienen primero', () => {
    const r = recorteKanban(lista(15));
    expect(r.visibles[0]).toBe('c1');
    expect(r.visibles.at(-1)).toBe('c10');
    expect(r.visibles).not.toContain('c11');
  });

  it('una columna vacía no rompe nada', () => {
    const r = recorteKanban<string>([]);
    expect(r.visibles).toEqual([]);
    expect(r.ocultas).toBe(0);
    expect(r.hayMas).toBe(false);
  });

  it('un tope inválido cae en el de siempre', () => {
    expect(recorteKanban(lista(20), 0).visibles).toHaveLength(TOPE_FINALIZADOS);
    expect(recorteKanban(lista(20), -5).visibles).toHaveLength(TOPE_FINALIZADOS);
    expect(recorteKanban(lista(20), Number.NaN).visibles).toHaveLength(TOPE_FINALIZADOS);
  });

  it('acepta un tope propio', () => {
    const r = recorteKanban(lista(20), 3);
    expect(r.visibles).toHaveLength(3);
    expect(r.ocultas).toBe(17);
  });
});
