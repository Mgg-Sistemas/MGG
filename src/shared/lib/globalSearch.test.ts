import { describe, it, expect } from 'vitest';
import { relevancia, LIMITE_PRODUCTOS } from './globalSearch';

/** Los seis vinagres reales que devolvía el buscador, en el orden en que salían. */
const VINAGRES = [
  { nombre: 'VINAGRE 5L GALON', sku: 'VIV-118' },
  { nombre: 'VINAGRE 5L', sku: 'VIV-117' },
  { nombre: 'VINAGRE DTORINO 5L', sku: 'VIV-119' },
  { nombre: 'VINAGRE 1 LTS', sku: 'VIV-072' },
  { nombre: 'VINAGRE GRANDE', sku: 'VIV-073' },
  { nombre: 'VINAGRE', sku: 'VIV-122' },
];

const ordenar = (busqueda: string) =>
  VINAGRES.slice()
    .sort((a, b) => relevancia(a.nombre, a.sku, busqueda) - relevancia(b.nombre, b.sku, busqueda)
      || a.nombre.localeCompare(b.nombre, 'es'))
    .map((p) => p.nombre);

describe('relevancia · cómo se ordena el buscador global', () => {
  it('el código exacto gana sobre todo', () => {
    expect(relevancia('VINAGRE 5L GALON', 'VIV-118', 'viv-118')).toBe(0);
  });

  it('el nombre exacto va antes que los que solo empiezan igual', () => {
    expect(relevancia('VINAGRE', 'VIV-122', 'vinagre'))
      .toBeLessThan(relevancia('VINAGRE GRANDE', 'VIV-073', 'vinagre'));
  });

  it('lo que empieza con lo escrito va antes que lo que solo lo contiene', () => {
    expect(relevancia('VINAGRE 5L', 'VIV-117', 'vina'))
      .toBeLessThan(relevancia('GALON DE VINAGRE', 'VIV-999', 'vina'));
  });

  it('ignora los acentos', () => {
    expect(relevancia('PLÁTANO VERDE', 'HTL-009', 'platano')).toBe(2);
    expect(relevancia('PLATANO VERDE', 'HTL-009', 'plátano')).toBe(2);
  });

  it('buscando «vinagre», el producto que se llama así queda primero', () => {
    expect(ordenar('vinagre')[0]).toBe('VINAGRE');
  });

  it('buscando «vina», los seis salen ordenados por nombre y no al azar', () => {
    expect(ordenar('vina')).toEqual([
      'VINAGRE', 'VINAGRE 1 LTS', 'VINAGRE 5L', 'VINAGRE 5L GALON', 'VINAGRE DTORINO 5L', 'VINAGRE GRANDE',
    ]);
  });

  it('sin texto no reordena nada', () => {
    expect(relevancia('CUALQUIERA', 'ABC-001', '')).toBe(4);
    expect(relevancia('CUALQUIERA', 'ABC-001', '   ')).toBe(4);
  });

  it('ofrece más de seis: una familia grande no entra en seis renglones', () => {
    expect(LIMITE_PRODUCTOS).toBeGreaterThan(VINAGRES.length);
  });
});
