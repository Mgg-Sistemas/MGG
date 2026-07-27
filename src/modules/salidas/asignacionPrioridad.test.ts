import { describe, it, expect } from 'vitest';
import { rangoSede, planEntregaPorPrioridad, stockTotal, type CandidatoAlmacen } from './asignacionPrioridad';

describe('rangoSede', () => {
  it('ordena Los Pinos antes que Matanzas y el resto al final', () => {
    expect(rangoSede('Los Pinos')).toBe(0);
    expect(rangoSede('LOS PINOS')).toBe(0);
    expect(rangoSede('centro de fundicion - matanzas')).toBe(1);
    expect(rangoSede('CENTRO DE ACOPIO - LA ESPERANZA')).toBe(2);
    expect(rangoSede(null)).toBe(2);
  });
});

const c = (almacen: string, sede: string, stock: number, costo = 1): CandidatoAlmacen => ({ almacen, sede, stock, costo });

describe('planEntregaPorPrioridad', () => {
  it('descuenta primero de Los Pinos aunque Matanzas tenga más stock', () => {
    const cand = [c('DEPOSITO', 'CENTRO DE FUNDICION - MATANZAS', 100), c('INSUMOS', 'LOS PINOS', 10)];
    const { tramos, faltante } = planEntregaPorPrioridad(cand, 5);
    expect(faltante).toBe(0);
    expect(tramos).toEqual([{ almacen: 'INSUMOS', cantidad: 5, stock: 10, costo: 1 }]);
  });

  it('cascada a Matanzas cuando Los Pinos no alcanza', () => {
    const cand = [c('INSUMOS', 'LOS PINOS', 3), c('DEPOSITO', 'CENTRO DE FUNDICION - MATANZAS', 100)];
    const { tramos, faltante } = planEntregaPorPrioridad(cand, 8);
    expect(faltante).toBe(0);
    expect(tramos.map((t) => [t.almacen, t.cantidad])).toEqual([['INSUMOS', 3], ['DEPOSITO', 5]]);
  });

  it('reporta faltante cuando no hay stock suficiente en ningún almacén', () => {
    const cand = [c('INSUMOS', 'LOS PINOS', 2)];
    const { tramos, faltante } = planEntregaPorPrioridad(cand, 10);
    expect(tramos).toEqual([{ almacen: 'INSUMOS', cantidad: 2, stock: 2, costo: 1 }]);
    expect(faltante).toBe(8);
  });

  it('dentro de la misma sede desempata por más stock', () => {
    const cand = [c('A', 'LOS PINOS', 3), c('B', 'LOS PINOS', 20)];
    const { tramos } = planEntregaPorPrioridad(cand, 5);
    expect(tramos[0].almacen).toBe('B');
  });

  it('ignora almacenes sin stock', () => {
    const cand = [c('VACIO', 'LOS PINOS', 0), c('DEPOSITO', 'CENTRO DE FUNDICION - MATANZAS', 4)];
    const { tramos } = planEntregaPorPrioridad(cand, 2);
    expect(tramos).toEqual([{ almacen: 'DEPOSITO', cantidad: 2, stock: 4, costo: 1 }]);
  });
});

describe('stockTotal', () => {
  it('suma el stock de todos los candidatos', () => {
    expect(stockTotal([c('A', 'LOS PINOS', 3), c('B', 'CENTRO DE FUNDICION - MATANZAS', 7)])).toBe(10);
  });
});
