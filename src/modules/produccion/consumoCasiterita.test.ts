import { describe, it, expect } from 'vitest';
import {
  bagsDeInventario, bagsSobregirados, kgPorBag, lineaCasiterita, textoSobregiro,
} from './consumoCasiterita';

const PROD = 'prod-casiterita';
const ALM = 'SNO₂ CASITERITA ALMACEN';

describe('qué big bags salen del inventario', () => {
  it('solo los traídos del detallado, y solo con kilos', () => {
    const bags = [
      { origen_detalle_id: 'a', kg: 100 },
      { origen_detalle_id: null, kg: 50 },   // cargado a mano: no está en stock
      { origen_detalle_id: 'b', kg: 0 },     // elegido y después vaciado
      { origen_detalle_id: 'c', kg: null },
    ];
    expect(bagsDeInventario(bags).map((b) => b.origen_detalle_id)).toEqual(['a']);
  });

  it('la misma bolsa en dos renglones suma, no compite', () => {
    // Es el caso real de la colada 3: 193 kg en un renglón y 669 en otro.
    const bags = [{ origen_detalle_id: 'x', kg: 193 }, { origen_detalle_id: 'x', kg: 669 }];
    expect(kgPorBag(bags).get('x')).toBe(862);
  });
});

describe('la línea de casiterita que descuenta el inventario', () => {
  it('junta todas las bolsas en una sola línea', () => {
    const l = lineaCasiterita([
      { origen_detalle_id: 'a', kg: 1000, tasa: 18.74 },
      { origen_detalle_id: 'b', kg: 683.5, tasa: 18.74 },
    ], PROD, ALM);
    expect(l).toMatchObject({ producto_id: PROD, almacen: ALM, cantidad: 1683.5, costo: 18.74 });
    expect(l?.material_nombre).toContain('2 big bags');
  });

  it('con tasas distintas usa el promedio ponderado, para que el valor dé exacto', () => {
    const l = lineaCasiterita([
      { origen_detalle_id: 'a', kg: 100, tasa: 10 },
      { origen_detalle_id: 'b', kg: 300, tasa: 20 },
    ], PROD, ALM);
    // 100×10 + 300×20 = 7.000 sobre 400 kg.
    expect(l?.costo).toBe(17.5);
    expect(round2((l?.cantidad ?? 0) * (l?.costo ?? 0))).toBe(7000);
  });

  it('una bolsa sin tasa no rompe el cálculo', () => {
    const l = lineaCasiterita([{ origen_detalle_id: 'a', kg: 100, tasa: null }], PROD, ALM);
    expect(l).toMatchObject({ cantidad: 100, costo: 0 });
  });

  it('el singular se escribe en singular', () => {
    expect(lineaCasiterita([{ origen_detalle_id: 'a', kg: 5, tasa: 1 }], PROD, ALM)?.material_nombre)
      .toContain('1 big bag del');
  });

  it('sin bolsas del inventario no hay línea que descontar', () => {
    expect(lineaCasiterita([], PROD, ALM)).toBeNull();
    expect(lineaCasiterita([{ kg: 500 }], PROD, ALM)).toBeNull();
  });

  it('sin ficha de casiterita no se inventa un consumo', () => {
    expect(lineaCasiterita([{ origen_detalle_id: 'a', kg: 10 }], null, ALM)).toBeNull();
    expect(lineaCasiterita([{ origen_detalle_id: 'a', kg: 10 }], PROD, '')).toBeNull();
  });
});

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

describe('que la misma bolsa no se queme dos veces', () => {
  const peso = new Map([['x', 1223.5], ['y', 300]]);
  const nombre = new Map([['x', 'LOS NEGRITOS · precinto 45'], ['y', 'NAVIL']]);

  it('pasa cuando la bolsa alcanza', () => {
    expect(bagsSobregirados([{ origen_detalle_id: 'x', kg: 862 }], peso, nombre, new Map())).toEqual([]);
  });

  it('avisa cuando otra colada ya se llevó lo que falta', () => {
    const otras = new Map([['x', 1000]]);
    const s = bagsSobregirados([{ origen_detalle_id: 'x', kg: 862 }], peso, nombre, otras);
    expect(s).toEqual([{ id: 'x', etiqueta: 'LOS NEGRITOS · precinto 45', pide: 862, hay: 223.5 }]);
  });

  it('suma los renglones antes de comparar', () => {
    // Por separado cada uno entra; juntos se pasan de los 300 kg.
    const s = bagsSobregirados(
      [{ origen_detalle_id: 'y', kg: 200 }, { origen_detalle_id: 'y', kg: 200 }], peso, nombre, new Map(),
    );
    expect(s).toEqual([{ id: 'y', etiqueta: 'NAVIL', pide: 400, hay: 300 }]);
  });

  it('una bolsa que ya no existe en el detallado no tiene kilos que dar', () => {
    const s = bagsSobregirados([{ origen_detalle_id: 'zz', kg: 1 }], peso, nombre, new Map());
    expect(s).toEqual([{ id: 'zz', etiqueta: 'Big bag', pide: 1, hay: 0 }]);
  });

  it('un gramo de diferencia es redondeo, no un sobregiro', () => {
    expect(bagsSobregirados([{ origen_detalle_id: 'y', kg: 300.01 }], peso, nombre, new Map())).toEqual([]);
  });

  it('el aviso dice qué bolsa y cuánto queda', () => {
    const s = bagsSobregirados([{ origen_detalle_id: 'y', kg: 400 }], peso, nombre, new Map());
    expect(textoSobregiro(s)).toBe('«NAVIL»: pedís 400 kg y quedan 300 kg');
  });
});
