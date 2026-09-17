import { describe, expect, it } from 'vitest';
import { calcularAjusteProduccion, detalleAjuste } from './ajusteProduccion';

const base = { cantidadActual: 847.5, cantidadNueva: 837.5, costoProceso: 93.23, precioVenta: null, nota: 'Se pesó de más al cerrar la colada' };

describe('calcularAjusteProduccion', () => {
  it('caso real: 847,5 → 837,5 saca 10 del inventario y reparte el mismo costo', () => {
    const r = calcularAjusteProduccion(base);
    expect(r.delta).toBe(-10);
    expect(r.cantidad).toBe(837.5);
    expect(r.costoUnitario).toBe(0.11);
    expect(r.ganancia).toBeNull();
  });

  it('subir la cantidad entra la diferencia y recalcula la ganancia', () => {
    const r = calcularAjusteProduccion({ ...base, cantidadNueva: 900, precioVenta: 2 });
    expect(r.delta).toBe(52.5);
    expect(r.ganancia).toBe(round(900 * (2 - r.costoUnitario)));
  });

  it('exige nota, cantidad válida y un cambio real', () => {
    expect(() => calcularAjusteProduccion({ ...base, nota: '   ' })).toThrow(/motivo/i);
    expect(() => calcularAjusteProduccion({ ...base, nota: 'x' })).toThrow(/corto/i);
    expect(() => calcularAjusteProduccion({ ...base, cantidadNueva: 0 })).toThrow(/mayor que 0/i);
    expect(() => calcularAjusteProduccion({ ...base, cantidadNueva: -5 })).toThrow(/mayor que 0/i);
    expect(() => calcularAjusteProduccion({ ...base, cantidadNueva: 847.5 })).toThrow(/misma/i);
  });
});

describe('detalleAjuste', () => {
  it('arma el texto que se ve en el kardex', () => {
    expect(detalleAjuste('fundicion', 1, 847.5, 837.5, ' Se pesó de más '))
      .toBe('Corrección de colada #1: 847.5 → 837.5 · Se pesó de más');
    expect(detalleAjuste('refinacion', null, 10, 12, 'Faltaba un lingote'))
      .toBe('Corrección de refinación: 10 → 12 · Faltaba un lingote');
  });
});

function round(n: number) { return Math.round(n * 100) / 100; }
