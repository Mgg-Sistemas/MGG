import { describe, expect, it } from 'vitest';
import { conDisponibleReal, type OrigenRefinable } from './disponibleRefinar';

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
