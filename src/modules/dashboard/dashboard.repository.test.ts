import { describe, expect, it } from 'vitest';
import { calcularValorInventario, calcularValorPorSede } from './dashboard.repository';

const almacenes = [
  { nombre: 'Los Pinos', sede: 'LOS PINOS' },
  { nombre: 'SNO₂ CASITERITA ALMACEN', sede: 'LOS PINOS' },
  { nombre: 'General', sede: 'CENTRO DE FUNDICION - MATANZAS' },
  { nombre: 'COMBUSTIBLE', sede: 'CENTRO DE FUNDICION - MATANZAS' },
  { nombre: 'La Esperanza', sede: 'CENTRO DE ACOPIO - LA ESPERANZA' },
];

describe('calcularValorPorSede', () => {
  it('reparte stock × precio por sede y suma exactamente el valor de la tarjeta', () => {
    const productos = [
      { id: 'cas', stock: 100, precio: 18.74 },
      { id: 'diesel', stock: 30, precio: 1.5 },
      { id: 'arroz', stock: 12, precio: 2 },
    ];
    const existencias = [
      { producto_id: 'cas', almacen: 'SNO₂ CASITERITA ALMACEN', stock: 100 },
      { producto_id: 'diesel', almacen: 'COMBUSTIBLE', stock: 20 },
      { producto_id: 'diesel', almacen: 'General', stock: 10 },
      { producto_id: 'arroz', almacen: 'La Esperanza', stock: 2 },
      { producto_id: 'arroz', almacen: 'Los Pinos', stock: 10 },
    ];
    const r = calcularValorPorSede(productos, existencias, almacenes);
    expect(r).toEqual([
      { sede: 'Los Pinos', valor: 1894 },
      { sede: 'Matanzas', valor: 45 },
      { sede: 'Acopio La Esperanza', valor: 4 },
    ]);
    expect(r.reduce((a, s) => a + s.valor, 0)).toBeCloseTo(calcularValorInventario(productos as never), 2);
  });

  it('ignora inactivos y manda a «Sin sede» el stock sin existencia asignada', () => {
    const r = calcularValorPorSede(
      [{ id: 'a', stock: 5, precio: 10 }],
      [{ producto_id: 'a', almacen: 'General', stock: 3 }, { producto_id: 'inactivo', almacen: 'General', stock: 99 }],
      almacenes,
    );
    expect(r).toEqual([{ sede: 'Matanzas', valor: 30 }, { sede: 'Sin sede', valor: 20 }]);
  });
});
