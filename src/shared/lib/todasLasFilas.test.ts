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

  it('con 2 páginas en paralelo, 1.146 productos llegan en un solo viaje y en orden', async () => {
    const t = tabla(1146);
    const filas = await todasLasFilas(t.pagina, 1000, 2);
    expect(filas.map((f) => f.id)).toEqual(Array.from({ length: 1146 }, (_, i) => i + 1));
    expect(t.llamadas).toEqual([[0, 999], [1000, 1999]]);
  });

  it('en paralelo sigue pidiendo lotes hasta una página incompleta', async () => {
    const t = tabla(7);
    expect(await todasLasFilas(t.pagina, 2, 2)).toHaveLength(7);
    expect(t.llamadas).toEqual([[0, 1], [2, 3], [4, 5], [6, 7]]);
    const exacta = tabla(4);
    expect(await todasLasFilas(exacta.pagina, 2, 2)).toHaveLength(4);
    expect(exacta.llamadas).toEqual([[0, 1], [2, 3], [4, 5], [6, 7]]);
  });

  it('en paralelo propaga el error de cualquier página', async () => {
    const pagina = (desde: number) => Promise.resolve(desde === 0
      ? { data: Array.from({ length: 3 }, (_, i) => ({ id: i })), error: null }
      : { data: null, error: { message: 'boom' } });
    await expect(todasLasFilas(pagina, 3, 2)).rejects.toEqual({ message: 'boom' });
  });
});
