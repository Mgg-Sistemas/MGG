import { describe, expect, it } from 'vitest';
import type { ItemCocina } from '@/shared/lib/types';
import {
  claveNeto, devolucionesDe, devueltoPorProducto, disponibleDe, esSeleccionable, excesosDeConsumo,
  mensajeExcesos, netoDeComida, type MovimientoEfectivo, type ViverParaConsumo,
} from './stockConsumo';

const viver = (id: string, nombre: string, stock: number, almacen = 'Los Pinos'): ViverParaConsumo =>
  ({ producto_id: id, nombre, unidad: 'KILOGRAMO', stock, almacen });

const mapa = (...vs: ViverParaConsumo[]) => new Map(vs.map((v) => [v.producto_id, v]));

const item = (producto_id: string, cantidad: number, almacen: string | null = 'Los Pinos'): ItemCocina =>
  ({ producto_id, sku: producto_id, nombre: producto_id.toUpperCase(), unidad: 'KILOGRAMO', cantidad, precio: 1, subtotal: cantidad, almacen });

describe('esSeleccionable', () => {
  it('con stock se elige; sin stock no', () => {
    expect(esSeleccionable(4.5)).toBe(true);
    expect(esSeleccionable(0)).toBe(false);
    expect(esSeleccionable(-2)).toBe(false);
    expect(esSeleccionable(0.004)).toBe(false);
  });
  it('sin stock pero ya en la comida que se edita, sí: ese stock lo tiene la comida', () => {
    expect(esSeleccionable(0, true)).toBe(true);
  });
});

describe('excesosDeConsumo', () => {
  const V = mapa(viver('pim', 'PIMENTON', 4.5), viver('ceb', 'CEBOLLA', 10), viver('que', 'QUESO DURO', 0));

  it('el caso real: 700 de pimentón con 4,5 en el almacén', () => {
    const ex = excesosDeConsumo([{ producto_id: 'pim', cantidad: 700 }, { producto_id: 'ceb', cantidad: 1.5 }], V);
    expect(ex).toEqual([{ producto_id: 'pim', nombre: 'PIMENTON', unidad: 'KILOGRAMO', pedido: 700, disponible: 4.5, almacen: 'Los Pinos' }]);
  });

  it('lo que alcanza no aparece; pedir justo lo que hay alcanza', () => {
    expect(excesosDeConsumo([{ producto_id: 'pim', cantidad: 4.5 }], V)).toEqual([]);
    expect(excesosDeConsumo([{ producto_id: 'pim', cantidad: 4.504 }], V)).toEqual([]);
  });

  it('un víver sin stock es un exceso aunque se pida poquito', () => {
    const ex = excesosDeConsumo([{ producto_id: 'que', cantidad: 0.5 }], V);
    expect(ex.length).toBe(1);
    expect(ex[0].disponible).toBe(0);
  });

  it('dos renglones del mismo víver se suman antes de comparar', () => {
    const ex = excesosDeConsumo([{ producto_id: 'pim', cantidad: 3 }, { producto_id: 'pim', cantidad: 2 }], V);
    expect(ex.length).toBe(1);
    expect(ex[0].pedido).toBe(5);
  });

  it('al editar, lo que la comida devuelve cuenta como disponible', () => {
    // La comida tenía 4 de pimentón; el almacén quedó en 0,5. Editar a 4,5 alcanza (0,5 + 4).
    const V2 = mapa(viver('pim', 'PIMENTON', 0.5));
    expect(excesosDeConsumo([{ producto_id: 'pim', cantidad: 4.5 }], V2, new Map([['pim', 4]]))).toEqual([]);
    expect(excesosDeConsumo([{ producto_id: 'pim', cantidad: 4.6 }], V2, new Map([['pim', 4]])).length).toBe(1);
  });

  it('cantidades en cero o negativas se ignoran', () => {
    expect(excesosDeConsumo([{ producto_id: 'que', cantidad: 0 }], V)).toEqual([]);
  });

  it('disponibleDe redondea a dos decimales', () => {
    expect(disponibleDe(0.1, 0.2)).toBe(0.3);
  });
});

describe('mensajeExcesos', () => {
  it('dice el víver, lo pedido y lo que hay, con el almacén', () => {
    const m = mensajeExcesos([{ producto_id: 'pim', nombre: 'PIMENTON', unidad: 'KILOGRAMO', pedido: 700, disponible: 4.5, almacen: 'Los Pinos' }]);
    expect(m).toContain('«PIMENTON» pide 700 y hay 4.5 KILOGRAMO en Los Pinos');
    expect(m).toContain('Corregí la cantidad');
  });
  it('sin stock lo dice así, sin «hay 0»', () => {
    const m = mensajeExcesos([{ producto_id: 'q', nombre: 'QUESO DURO', unidad: 'KILOGRAMO', pedido: 1.5, disponible: 0, almacen: 'Los Pinos' }]);
    expect(m).toContain('«QUESO DURO» está sin stock en Los Pinos');
    expect(m).not.toContain('hay 0');
  });
  it('usa el formateador que le pasan (es-VE)', () => {
    const m = mensajeExcesos([{ producto_id: 'h', nombre: 'HUEVO', unidad: 'UNIDAD', pedido: 1440, disponible: 729, almacen: null }], (n) => n.toLocaleString('es-VE'));
    expect(m).toContain('pide 1.440 y hay 729 UNIDAD');
  });
  it('sin excesos, vacío', () => {
    expect(mensajeExcesos([])).toBe('');
  });
});

describe('netoDeComida', () => {
  const mov = (producto_id: string, antes: number, despues: number, delta: number, almacen = 'Los Pinos'): MovimientoEfectivo =>
    ({ producto_id, almacen, stock_antes: antes, stock_despues: despues, delta });

  it('una salida topeada en cero cuenta por lo que bajó, no por lo que pidió', () => {
    const neto = netoDeComida([mov('pim', 4.5, 0, -700)]);
    expect(neto.get(claveNeto('pim', 'Los Pinos'))).toBe(-4.5);
  });

  it('salida + reverso + salida nueva: queda lo último descontado', () => {
    const neto = netoDeComida([mov('ceb', 10, 8.5, -1.5), mov('ceb', 8.5, 10, 1.5), mov('ceb', 10, 9.3, -0.7)]);
    expect(neto.get(claveNeto('ceb', 'Los Pinos'))).toBe(-0.7);
  });

  it('sin stock_antes/stock_despues cae al delta', () => {
    const neto = netoDeComida([{ producto_id: 'x', almacen: 'Los Pinos', stock_antes: null, stock_despues: null, delta: -3 }]);
    expect(neto.get(claveNeto('x', 'Los Pinos'))).toBe(-3);
  });

  it('separa por almacén', () => {
    const neto = netoDeComida([mov('a', 5, 3, -2, 'Los Pinos'), mov('a', 9, 8, -1, 'La Esperanza')]);
    expect(neto.get(claveNeto('a', 'Los Pinos'))).toBe(-2);
    expect(neto.get(claveNeto('a', 'La Esperanza'))).toBe(-1);
  });
});

describe('devolucionesDe', () => {
  it('devuelve lo que bajó de verdad: 4,5 y no 700', () => {
    const neto = netoDeComida([{ producto_id: 'pim', almacen: 'Los Pinos', stock_antes: 4.5, stock_despues: 0, delta: -700 }]);
    const d = devolucionesDe([item('pim', 700)], neto);
    expect(d.length).toBe(1);
    expect(d[0].cantidad).toBe(4.5);
  });

  it('un renglón cuyo movimiento nunca se escribió no devuelve nada (la comida sí tiene kardex)', () => {
    // COC-2026-0443: huevos y pan quedaron en la comida pero su salida falló; devolverlos inventaba stock.
    const neto = netoDeComida([{ producto_id: 'pim', almacen: 'Los Pinos', stock_antes: 4.5, stock_despues: 0, delta: -700 }]);
    const d = devolucionesDe([item('pim', 700), item('hue', 30)], neto);
    expect(d.map((x) => x.item.producto_id)).toEqual(['pim']);
  });

  it('una comida sin kardex propio (legado) devuelve la cantidad del renglón', () => {
    const d = devolucionesDe([item('arroz', 4), item('pollo', 2.5)], new Map());
    expect(d.map((x) => x.cantidad)).toEqual([4, 2.5]);
  });

  it('ya devuelto (neto 0 o positivo) no devuelve otra vez', () => {
    const neto = new Map([[claveNeto('a', 'Los Pinos'), 0], [claveNeto('b', 'Los Pinos'), 2]]);
    expect(devolucionesDe([item('a', 3), item('b', 2)], neto)).toEqual([]);
  });

  it('dos renglones del mismo víver no devuelven dos veces', () => {
    const neto = new Map([[claveNeto('a', 'Los Pinos'), -5]]);
    const d = devolucionesDe([item('a', 3), item('a', 2)], neto);
    expect(d.length).toBe(1);
    expect(d[0].cantidad).toBe(5);
  });

  it('devueltoPorProducto suma lo devuelto por víver', () => {
    const d = devolucionesDe([item('a', 3, 'Los Pinos'), item('a', 2, 'La Esperanza')],
      new Map([[claveNeto('a', 'Los Pinos'), -3], [claveNeto('a', 'La Esperanza'), -2]]));
    expect(devueltoPorProducto(d).get('a')).toBe(5);
  });
});
