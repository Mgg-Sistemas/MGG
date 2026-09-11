import { describe, it, expect } from 'vitest';
import { costoDeAlimentar, variacionPorPlato, totalesParaCierre } from './costoPorPlato';

describe('costoDeAlimentar', () => {
  it('divide el consumo entre los platos', () => {
    const c = costoDeAlimentar({ platos: 100, consumoValor: 250 });
    expect(c.porPlato).toBe(2.5);
  });

  it('sin platos servidos, el costo por plato NO es cero: es desconocido', () => {
    // Un «$0,00 por plato» al abrir el mercado es un dato falso.
    expect(costoDeAlimentar({ platos: 0, consumoValor: 300 }).porPlato).toBeNull();
  });

  it('redondea a 2 decimales', () => {
    expect(costoDeAlimentar({ platos: 3, consumoValor: 10 }).porPlato).toBe(3.33);
  });

  it('conserva el consumo y las entradas valorados', () => {
    const c = costoDeAlimentar({ platos: 10, consumoValor: 45.678, entradasValor: 120.004 });
    expect(c.consumo).toBe(45.68);
    expect(c.entradas).toBe(120);
  });

  it('los platos son enteros: no existe medio plato', () => {
    expect(costoDeAlimentar({ platos: 24.7, consumoValor: 100 }).platos).toBe(24);
  });

  it('ignora valores negativos cargados por error', () => {
    const c = costoDeAlimentar({ platos: -5, consumoValor: -20, entradasValor: -1 });
    expect(c).toMatchObject({ platos: 0, consumo: 0, entradas: 0, porPlato: null });
  });

  it('tolera campos ausentes o nulos', () => {
    expect(costoDeAlimentar({})).toMatchObject({ platos: 0, consumo: 0, porPlato: null });
    expect(costoDeAlimentar({ platos: null, consumoValor: null }).porPlato).toBeNull();
  });

  it('el caso de la captura de GT: 3.342 platos y $3.626,86 dan $1,09', () => {
    expect(costoDeAlimentar({ platos: 3342, consumoValor: 3626.86 }).porPlato).toBe(1.09);
  });
});

describe('variacionPorPlato', () => {
  it('un ciclo más caro da variación positiva', () => {
    expect(variacionPorPlato(1.2, 1)).toBe(20);
  });

  it('un ciclo más barato da variación negativa', () => {
    expect(variacionPorPlato(0.9, 1.5)).toBe(-40);
  });

  it('sin ciclo anterior no hay contra qué comparar', () => {
    expect(variacionPorPlato(1.09, null)).toBeNull();
  });

  it('sin ciclo actual tampoco', () => {
    expect(variacionPorPlato(null, 1.09)).toBeNull();
  });

  it('un anterior en cero no sirve de base', () => {
    expect(variacionPorPlato(1.09, 0)).toBeNull();
  });
});

describe('totalesParaCierre', () => {
  it('conserva lo que el ciclo movió', () => {
    expect(totalesParaCierre({ platos: 1877, consumoValor: 2072.1, entradasValor: 500 }))
      .toEqual({ platos: 1877, valor: 2072.1, entradasValor: 500 });
  });

  it('un ciclo descartado guarda sus platos: pasaron igual', () => {
    // Antes se guardaba 0 y el histórico decía «0 platos» sobre un detalle de 1.877.
    expect(totalesParaCierre({ platos: 1877, consumoValor: 2072.1 }).platos).toBe(1877);
  });

  it('sin datos devuelve ceros, no rompe', () => {
    expect(totalesParaCierre(null)).toEqual({ platos: 0, valor: 0, entradasValor: 0 });
    expect(totalesParaCierre()).toEqual({ platos: 0, valor: 0, entradasValor: 0 });
  });

  it('redondea el dinero y entera los platos', () => {
    expect(totalesParaCierre({ platos: 10.9, consumoValor: 33.335 }))
      .toEqual({ platos: 10, valor: 33.34, entradasValor: 0 });
  });

  it('ignora negativos cargados por error', () => {
    expect(totalesParaCierre({ platos: -5, consumoValor: -20, entradasValor: -1 }))
      .toEqual({ platos: 0, valor: 0, entradasValor: 0 });
  });
});
