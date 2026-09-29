import { describe, expect, it } from 'vitest';
import { conDisponibleReal, kgTomadosPorRefinaciones, menosLoRefinado, type OrigenRefinable } from './disponibleRefinar';

const colada = (id: string, kg: number, fecha: string, num: number): OrigenRefinable => ({
  produccion_id: id, producto_id: 'estano', almacen: 'ESTAÑO EN BRUTO', fecha, colada_num: num, estano_kg: kg,
});

describe('conDisponibleReal', () => {
  it('caso real: la colada dio 847,5 y el inventario quedó en 837,5 tras la corrección', () => {
    const r = conDisponibleReal([colada('c1', 847.5, '2026-09-10', 1)], [{ producto_id: 'estano', almacen: 'ESTAÑO EN BRUTO', stock: 837.5 }]);
    expect(r[0].estano_kg).toBe(837.5);
    expect(r[0].producido_kg).toBe(847.5);
  });

  it('con varias coladas del mismo almacén, el recorte le toca a la más reciente', () => {
    const r = conDisponibleReal(
      [colada('c2', 100, '2026-09-10', 2), colada('c1', 100, '2026-09-01', 1)],
      [{ producto_id: 'estano', almacen: 'ESTAÑO EN BRUTO', stock: 150 }],
    );
    expect(r.find((x) => x.produccion_id === 'c1')!.estano_kg).toBe(100);
    expect(r.find((x) => x.produccion_id === 'c2')!.estano_kg).toBe(50);
  });

  it('sin stock el origen queda en 0, y sin existencia se deja como está', () => {
    const sinStock = conDisponibleReal([colada('c1', 20, '2026-09-01', 1)], [{ producto_id: 'estano', almacen: 'ESTAÑO EN BRUTO', stock: 0 }]);
    expect(sinStock[0].estano_kg).toBe(0);
    const sinFila = conDisponibleReal([colada('c1', 20, '2026-09-01', 1)], []);
    expect(sinFila[0].estano_kg).toBe(20);
    const sinProducto = conDisponibleReal([{ ...colada('c1', 20, '2026-09-01', 1), producto_id: null }], []);
    expect(sinProducto[0].estano_kg).toBe(20);
  });

  it('respeta el orden original de la lista y no pierde orígenes', () => {
    const r = conDisponibleReal(
      [colada('c2', 10, '2026-09-10', 2), colada('c1', 10, '2026-09-01', 1)],
      [{ producto_id: 'estano', almacen: 'ESTAÑO EN BRUTO', stock: 12 }],
    );
    expect(r.map((x) => x.produccion_id)).toEqual(['c2', 'c1']);
    expect(r.map((x) => x.estano_kg)).toEqual([2, 10]);
  });
});

describe('kgTomadosPorRefinaciones', () => {
  it('caso real: la refinación #1 se llevó 1.162 de la colada #6 y 234 de la #5', () => {
    const t = kgTomadosPorRefinaciones([{
      produccion_id: 'r1',
      coladas: [{ produccion_id: 'c6', estano_kg: 1162, origen: 'colada' }, { produccion_id: 'c5', estano_kg: 234, origen: 'colada' }],
    }]);
    expect(t.get('c6')).toBe(1162);
    expect(t.get('c5')).toBe(234);
  });

  it('suma lo que varias refinaciones tomaron del mismo origen', () => {
    const t = kgTomadosPorRefinaciones([
      { produccion_id: 'r1', coladas: [{ produccion_id: 'c1', estano_kg: 100.5 }] },
      { produccion_id: 'r2', coladas: [{ produccion_id: 'c1', estano_kg: 200.25 }] },
    ]);
    expect(t.get('c1')).toBe(300.75);
  });

  it('ignora las líneas manuales, las vacías y la refinación que se está editando', () => {
    const t = kgTomadosPorRefinaciones([
      { produccion_id: 'r1', coladas: [{ produccion_id: 'ext', estano_kg: 50, origen: 'manual' }, { produccion_id: 'c1', estano_kg: 0 }] },
      { produccion_id: 'r2', coladas: [{ produccion_id: 'c1', estano_kg: 80 }] },
      { produccion_id: 'r3', coladas: null },
    ], 'r2');
    expect(t.size).toBe(0);
  });
});

describe('menosLoRefinado', () => {
  it('la colada ofrece lo que dio menos lo ya refinado', () => {
    const [c6] = menosLoRefinado([colada('c6', 1162, '2026-08-10', 6)], new Map([['c6', 1162]]));
    expect(c6.estano_kg).toBe(0);
    expect(c6.refinado_kg).toBe(1162);
    expect(c6.producido_kg).toBe(1162);
    const [c5] = menosLoRefinado([colada('c5', 1167, '2026-08-10', 5)], new Map([['c5', 234]]));
    expect(c5.estano_kg).toBe(933);
    expect(c5.refinado_kg).toBe(234);
  });

  it('nunca queda negativo si se tomó más de lo que dio (dato corregido después)', () => {
    const [c] = menosLoRefinado([colada('c1', 100, '2026-09-01', 1)], new Map([['c1', 130]]));
    expect(c.estano_kg).toBe(0);
    expect(c.refinado_kg).toBe(100);
  });

  it('sin refinaciones previas deja todo disponible y refinado en 0', () => {
    const [c] = menosLoRefinado([colada('c1', 100, '2026-09-01', 1)], new Map());
    expect(c.estano_kg).toBe(100);
    expect(c.refinado_kg).toBe(0);
  });

  it('encadenado con el tope de inventario, «lo que dio» sobrevive y el disponible es lo menor', () => {
    // Dio 1.167, ya se refinaron 234 → quedan 933; pero el almacén solo tiene 900.
    const r = conDisponibleReal(
      menosLoRefinado([colada('c5', 1167, '2026-08-10', 5)], new Map([['c5', 234]])),
      [{ producto_id: 'estano', almacen: 'ESTAÑO EN BRUTO', stock: 900 }],
    );
    expect(r[0].estano_kg).toBe(900);
    expect(r[0].producido_kg).toBe(1167);
    expect(r[0].refinado_kg).toBe(234);
  });
});
