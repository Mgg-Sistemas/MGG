import { describe, expect, it } from 'vitest';
import type { Producto } from '@/shared/lib/types';
import { armarDisponible, type ItemAgg, type SaldoItem } from './mercados.repository';

const prod = (id: string, estado: 'activo' | 'inactivo'): Producto =>
  ({ id, sku: `VIV-${id}`, nombre: `Víver ${id}`, categoria: 'VÍVERES', unidad: 'KG', precio: 1, estado } as unknown as Producto);

const agg = (id: string, cantidad: number): [string, ItemAgg] =>
  [id, { producto_id: id, sku: `VIV-${id}`, nombre: `Víver ${id}`, unidad: 'KG', cantidad, valor: cantidad }];

describe('armarDisponible · un producto desactivado sale de la lista de cocina', () => {
  const saldo: SaldoItem[] = [
    { producto_id: 'a', sku: 'VIV-a', nombre: 'Víver a', unidad: 'KG', cantidad: 10 },
    { producto_id: 'b', sku: 'VIV-b', nombre: 'Víver b', unidad: 'KG', cantidad: 5 },
  ];
  const sinNada = new Map<string, ItemAgg>();

  it('el inactivo no aparece aunque venga en el saldo heredado', () => {
    const prodById = new Map([['a', prod('a', 'activo')], ['b', prod('b', 'inactivo')]]);
    const filas = armarDisponible(saldo, sinNada, sinNada, sinNada, sinNada, prodById, new Map());
    expect(filas.map((f) => f.producto_id)).toEqual(['a']);
  });

  it('tampoco aparece si solo tuvo movimientos en el ciclo', () => {
    const prodById = new Map([['c', prod('c', 'inactivo')]]);
    const filas = armarDisponible([], new Map([agg('c', 3)]), sinNada, new Map([agg('c', 1)]), sinNada, prodById, new Map());
    expect(filas).toEqual([]);
  });

  it('un id que ya no está en el catálogo se sigue mostrando con su nombre guardado', () => {
    const filas = armarDisponible(saldo, sinNada, sinNada, sinNada, sinNada, new Map(), new Map());
    expect(filas.map((f) => f.nombre)).toEqual(['Víver a', 'Víver b']);
  });

  it('al reactivarlo vuelve con lo que tenga', () => {
    const prodById = new Map([['a', prod('a', 'activo')], ['b', prod('b', 'activo')]]);
    const filas = armarDisponible(saldo, sinNada, sinNada, sinNada, sinNada, prodById, new Map());
    expect(filas.find((f) => f.producto_id === 'b')?.queda).toBe(5);
  });
});
