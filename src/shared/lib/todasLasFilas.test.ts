import { describe, it, expect } from 'vitest';
import { todasLasFilas } from './todasLasFilas';

/** Simula PostgREST: una tabla de N filas servida por rangos [desde, hasta]. */
function tabla(n: number) {
  const filas = Array.from({ length: n }, (_, i) => ({ id: i + 1 }));
  const llamadas: Array<[number, number]> = [];
  const pagina = (desde: number, hasta: number) => {
    llamadas.push([desde, hasta]);
    return Promise.resolve({ data: filas.slice(desde, hasta + 1), error: null });
  };
  return { pagina, llamadas };
}

describe('todasLasFilas', () => {
  it('caso real: 1.108 existencias llegan completas en dos páginas (antes se cortaban en 1.000)', async () => {
    const t = tabla(1108);
    const filas = await todasLasFilas(t.pagina);
    expect(filas).toHaveLength(1108);
    expect(filas[1107].id).toBe(1108);
    expect(t.llamadas).toEqual([[0, 999], [1000, 1999]]);
  });

  it('una tabla chica hace una sola llamada; una vacía también', async () => {
    const chica = tabla(27);
    expect(await todasLasFilas(chica.pagina)).toHaveLength(27);
    expect(chica.llamadas).toHaveLength(1);
    const vacia = tabla(0);
    expect(await todasLasFilas(vacia.pagina)).toEqual([]);
    expect(vacia.llamadas).toHaveLength(1);
  });

  it('exactamente 1.000 filas: pide una segunda página (vacía) para confirmar que no hay más', async () => {
    const t = tabla(1000);
    expect(await todasLasFilas(t.pagina)).toHaveLength(1000);
    expect(t.llamadas).toEqual([[0, 999], [1000, 1999]]);
  });

  it('respeta un tamaño de página distinto y propaga el error de Supabase', async () => {
    const t = tabla(7);
    expect(await todasLasFilas(t.pagina, 3)).toHaveLength(7);
    expect(t.llamadas).toEqual([[0, 2], [3, 5], [6, 8]]);
    await expect(todasLasFilas(() => Promise.resolve({ data: null, error: { message: 'boom' } }))).rejects.toEqual({ message: 'boom' });
  });
});
