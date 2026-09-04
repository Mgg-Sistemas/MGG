import { describe, it, expect } from 'vitest';
import { filasSinCosto, valorRecuperado, claveFila, validarCosto, type FilaExistencia } from './sinCosto';

const fila = (over: Partial<FilaExistencia> = {}): FilaExistencia => ({
  producto_id: 'p1',
  almacen: 'Los Pinos',
  stock: 5,
  costo_promedio: 0,
  sku: 'INS-001',
  nombre: 'GUANTE DE CUERO',
  ...over,
});

describe('filasSinCosto', () => {
  it('toma las existencias con stock y costo 0', () => {
    const r = filasSinCosto([fila()]);
    expect(r).toHaveLength(1);
    expect(r[0].sku).toBe('INS-001');
  });

  it('ignora las que ya tienen costo', () => {
    expect(filasSinCosto([fila({ costo_promedio: 2.5 })])).toHaveLength(0);
  });

  it('ignora las existencias en 0 aunque no tengan costo', () => {
    // Un producto anclado a su almacén sin stock es normal; meterlo en la cola
    // sería ruido imposible de cerrar.
    expect(filasSinCosto([fila({ stock: 0 })])).toHaveLength(0);
    expect(filasSinCosto([fila({ stock: null })])).toHaveLength(0);
  });

  it('trata el costo null como sin costo', () => {
    expect(filasSinCosto([fila({ costo_promedio: null })])).toHaveLength(1);
  });

  it('el mismo producto en dos almacenes son dos filas distintas', () => {
    const r = filasSinCosto([fila(), fila({ almacen: 'General' })]);
    expect(r).toHaveLength(2);
    expect(new Set(r.map(claveFila)).size).toBe(2);
  });

  it('sugiere el precio del historial por SKU', () => {
    const r = filasSinCosto([fila()], [{ sku: 'INS-001', precio: 3.4, origen: 'OC-2026-0100' }]);
    expect(r[0].sugerido).toBe(3.4);
    expect(r[0].sugeridoOrigen).toBe('OC-2026-0100');
  });

  it('ante varios precios del mismo SKU se queda con el mayor', () => {
    // Subvalorar es el error que estamos corrigiendo: no conviene repetirlo.
    const r = filasSinCosto([fila()], [
      { sku: 'INS-001', precio: 2, origen: 'OC-A' },
      { sku: 'INS-001', precio: 7.25, origen: 'OC-B' },
      { sku: 'INS-001', precio: 5, origen: 'OC-C' },
    ]);
    expect(r[0].sugerido).toBe(7.25);
    expect(r[0].sugeridoOrigen).toBe('OC-B');
  });

  it('descarta precios historicos en 0 o negativos', () => {
    const r = filasSinCosto([fila()], [
      { sku: 'INS-001', precio: 0, origen: 'OC-A' },
      { sku: 'INS-001', precio: -3, origen: 'OC-B' },
    ]);
    expect(r[0].sugerido).toBeNull();
    expect(r[0].sugeridoOrigen).toBeNull();
  });

  it('sin historial deja el sugerido en null', () => {
    expect(filasSinCosto([fila()])[0].sugerido).toBeNull();
  });

  it('ordena por nombre y despues por almacen', () => {
    const r = filasSinCosto([
      fila({ producto_id: 'b', nombre: 'ZAPATO' }),
      fila({ producto_id: 'a', nombre: 'ALICATE', almacen: 'Los Pinos' }),
      fila({ producto_id: 'a', nombre: 'ALICATE', almacen: 'General' }),
    ]);
    expect(r.map((f) => `${f.nombre}/${f.almacen}`)).toEqual([
      'ALICATE/General', 'ALICATE/Los Pinos', 'ZAPATO/Los Pinos',
    ]);
  });

  it('tolera una lista vacia', () => {
    expect(filasSinCosto([])).toEqual([]);
  });
});

describe('valorRecuperado', () => {
  it('suma stock x costo tipeado', () => {
    const filas = [
      { producto_id: 'p1', almacen: 'Los Pinos', stock: 5 },
      { producto_id: 'p2', almacen: 'General', stock: 3 },
    ];
    const costos = new Map([['p1|Los Pinos', 2], ['p2|General', 1.5]]);
    expect(valorRecuperado(filas, costos)).toBe(14.5);
  });

  it('ignora las filas sin costo cargado', () => {
    const filas = [
      { producto_id: 'p1', almacen: 'Los Pinos', stock: 5 },
      { producto_id: 'p2', almacen: 'General', stock: 3 },
    ];
    expect(valorRecuperado(filas, new Map([['p1|Los Pinos', 2]]))).toBe(10);
  });

  it('redondea a dos decimales', () => {
    const costos = new Map([['p1|A', 0.333]]);
    expect(valorRecuperado([{ producto_id: 'p1', almacen: 'A', stock: 3 }], costos)).toBe(1);
  });

  it('sin costos devuelve 0', () => {
    expect(valorRecuperado([{ producto_id: 'p1', almacen: 'A', stock: 9 }], new Map())).toBe(0);
  });
});

describe('validarCosto', () => {
  it('acepta un costo positivo', () => {
    expect(validarCosto(3.5)).toBeNull();
  });

  it('rechaza el 0, que es justo lo que dejo el inventario asi', () => {
    expect(validarCosto(0)).toMatch(/mayor que 0/);
  });

  it('rechaza negativos', () => {
    expect(validarCosto(-1)).toMatch(/mayor que 0/);
  });

  it('rechaza lo que no es numero', () => {
    expect(validarCosto(Number.NaN)).toMatch(/número/);
  });

  it('frena un tipeo absurdo', () => {
    expect(validarCosto(2_000_000)).toMatch(/error de tipeo/);
  });
});
