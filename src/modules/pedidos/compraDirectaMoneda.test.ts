import { describe, it, expect } from 'vitest';
import { costoUnitarioUsd, esCompraEnBs, fechaTasaCompra, fechaVE, fmtTasa, fmtUsd4, tasaValida } from './compraDirectaMoneda';

describe('costoUnitarioUsd', () => {
  it('en dólares sigue siendo gasto / cantidad a 2 decimales', () => {
    expect(costoUnitarioUsd(25.5, 3, 'USD')).toBe(8.5);
    expect(costoUnitarioUsd(10, 3, 'USD')).toBe(3.33);
    expect(costoUnitarioUsd(10, 3, undefined)).toBe(3.33);
  });

  it('caso real CD-2026-0054: la cafetera en Bs entra en dólares, no en bolívares', () => {
    // Tasa BCV real del 20/08/2026 (tasa_cambio): 777,42 Bs/$.
    // Cafetera 367.606,68 Bs → $472,8547 (entró como $367.606,68); impresora 39.434,89 Bs → $50,7253.
    expect(costoUnitarioUsd(367606.68, 1, 'Bs', 777.42)).toBe(472.8547);
    expect(costoUnitarioUsd(39434.89, 1, 'Bs', 777.42)).toBe(50.7253);
  });

  it('en Bs conserva 4 decimales para artículos baratos', () => {
    // 3 Bs por 10 unidades a 150 Bs/$ → $0,002 por unidad (a 2 decimales sería 0)
    expect(costoUnitarioUsd(3, 10, 'Bs', 150)).toBe(0.002);
  });

  it('en Bs sin tasa NO deja entrar el costo: lanza error en español', () => {
    expect(() => costoUnitarioUsd(1000, 1, 'Bs')).toThrow(/bolívares/);
    expect(() => costoUnitarioUsd(1000, 1, 'Bs', 0)).toThrow(/tasa/);
    expect(() => costoUnitarioUsd(1000, 1, 'Bs', null)).toThrow();
    expect(() => costoUnitarioUsd(1000, 1, 'bs', NaN)).toThrow();
  });

  it('sin gasto o sin cantidad devuelve 0 (entrada sin costo) en cualquier moneda', () => {
    expect(costoUnitarioUsd(0, 5, 'Bs')).toBe(0);
    expect(costoUnitarioUsd(null, 5, 'Bs')).toBe(0);
    expect(costoUnitarioUsd(100, 0, 'Bs', 150)).toBe(0);
    expect(costoUnitarioUsd(-5, 1, 'USD')).toBe(0);
  });

  it('acepta la moneda con mayúsculas o espacios', () => {
    expect(esCompraEnBs('Bs')).toBe(true);
    expect(esCompraEnBs(' BS ')).toBe(true);
    expect(esCompraEnBs('USD')).toBe(false);
    expect(esCompraEnBs(null)).toBe(false);
  });
});

describe('tasaValida', () => {
  it('solo números finitos mayores que 0 (un string numérico NO vale: el tipo no debe mentir)', () => {
    expect(tasaValida(145.32)).toBe(true);
    expect(tasaValida('145.32')).toBe(false);
    expect(tasaValida(0)).toBe(false);
    expect(tasaValida(-1)).toBe(false);
    expect(tasaValida(null)).toBe(false);
    expect(tasaValida(undefined)).toBe(false);
    expect(tasaValida(Infinity)).toBe(false);
  });
});

describe('fechaVE / fechaTasaCompra', () => {
  it('usa la fecha de Venezuela, no la UTC (a las 21:00 VE todavía es el mismo día)', () => {
    expect(fechaVE('2026-08-28T01:00:00Z')).toBe('2026-08-27');
    expect(fechaVE('2026-08-28T12:00:00Z')).toBe('2026-08-28');
    expect(fechaVE(null)).toBeNull();
    expect(fechaVE('no es fecha')).toBeNull();
  });

  it('ancla la tasa al día del pago y, si no se pagó, al de creación de la compra', () => {
    expect(fechaTasaCompra({ created_at: '2026-08-18T10:00:00Z' }, '2026-08-20T14:03:00.000Z')).toEqual({ fecha: '2026-08-20', anclaje: 'pago' });
    expect(fechaTasaCompra({ created_at: '2026-08-18T10:00:00Z' }, null)).toEqual({ fecha: '2026-08-18', anclaje: 'creacion' });
    expect(fechaTasaCompra({})).toBeNull();
  });
});

describe('formatos', () => {
  it('la tasa y el costo en $ se muestran igual en todas las pantallas', () => {
    expect(fmtTasa(777.42)).toBe('777,42 Bs/$');
    expect(fmtTasa(777.4215)).toBe('777,4215 Bs/$');
    expect(fmtTasa(null)).toBe('—');
    expect(fmtUsd4(0.002)).toBe('$ 0,002');
    expect(fmtUsd4(472.8547)).toBe('$ 472,8547');
    expect(fmtUsd4(8.5)).toBe('$ 8,50');
  });
});
