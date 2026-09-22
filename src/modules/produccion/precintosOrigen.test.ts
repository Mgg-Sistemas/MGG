import { describe, it, expect } from 'vitest';
import { precintosDeColada, precintosDeRefinacion, resumenPrecintos, listaPrecintos } from './precintosOrigen';

describe('precintos de una colada', () => {
  it('saca el precinto de cada big bag, en el orden en que se cargaron', () => {
    expect(precintosDeColada({ big_bags: [
      { kg: 100, precinto: '0012' },
      { kg: 80, precinto: '0007' },
    ] })).toEqual(['0012', '0007']);
  });

  it('ignora los big bags sin precinto', () => {
    expect(precintosDeColada({ big_bags: [
      { kg: 100, precinto: '0012' },
      { kg: 80, precinto: '' },
      { kg: 50, precinto: '   ' },
    ] })).toEqual(['0012']);
  });

  it('no repite un precinto que aparece dos veces', () => {
    // Un mismo saco puede entrar en dos renglones si se cargó por partes.
    expect(precintosDeColada({ big_bags: [
      { kg: 60, precinto: 'A-15' },
      { kg: 40, precinto: 'a-15' },
    ] })).toEqual(['A-15']);
  });

  it('recorta los espacios de los lados', () => {
    expect(precintosDeColada({ big_bags: [{ kg: 1, precinto: '  99  ' }] })).toEqual(['99']);
  });

  it('una colada sin big bags no tiene precintos', () => {
    expect(precintosDeColada({ big_bags: [] })).toEqual([]);
    expect(precintosDeColada({})).toEqual([]);
    expect(precintosDeColada(null)).toEqual([]);
    expect(precintosDeColada(undefined)).toEqual([]);
  });
});

describe('precinto de una refinación', () => {
  it('es el del lote final, el que se le estampa al lingote', () => {
    expect(precintosDeRefinacion({ n_precinto: 'LOTE-2026-04' })).toEqual(['LOTE-2026-04']);
  });

  it('una refinación sin precinto final no aporta ninguno', () => {
    expect(precintosDeRefinacion({ n_precinto: '' })).toEqual([]);
    expect(precintosDeRefinacion({})).toEqual([]);
    expect(precintosDeRefinacion(null)).toEqual([]);
  });
});

describe('cómo se muestran', () => {
  it('con pocos, se muestran todos', () => {
    expect(resumenPrecintos(['12', '13'])).toBe('12, 13');
    expect(resumenPrecintos(['12', '13', '14'])).toBe('12, 13, 14');
  });

  it('con muchos, se recortan y se dice cuántos faltan', () => {
    expect(resumenPrecintos(['1', '2', '3', '4', '5'])).toBe('1, 2, 3 +2 más');
  });

  it('el tope se puede cambiar', () => {
    expect(resumenPrecintos(['1', '2', '3', '4'], 1)).toBe('1 +3 más');
  });

  it('sin precintos, no muestra nada (no un «—» que el llamador no pidió)', () => {
    expect(resumenPrecintos([])).toBe('');
    expect(resumenPrecintos(['', '  '])).toBe('');
  });

  it('el recorte cuenta los ÚNICOS, no los repetidos', () => {
    // Si contara los repetidos diría «+1 más» y no habría ninguno más.
    expect(resumenPrecintos(['7', '7', '8'])).toBe('7, 8');
  });

  it('la lista completa va sin recortar, para el PDF y el título emergente', () => {
    expect(listaPrecintos(['1', '2', '3', '4', '5'])).toBe('1, 2, 3, 4, 5');
    expect(listaPrecintos([])).toBe('');
  });
});
