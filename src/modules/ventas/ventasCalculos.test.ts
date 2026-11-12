import { describe, expect, it } from 'vitest';
import { calcularTotalesVenta } from './ventasCalculos';

describe('calcularTotalesVenta', () => {
  it('suma el IVA sobre la base, no sobre el subtotal', () => {
    const t = calcularTotalesVenta(
      [{ cantidad: 2, precio_unit: 50, costo_unit: 30 }], 16, 10);
    expect(t.subtotal).toBe(100);
    expect(t.ivaMonto).toBe(14.4);   // (100 - 10) x 0,16
    expect(t.total).toBe(104.4);     // 100 - 10 + 14,4
  });

  it('la ganancia no incluye el IVA', () => {
    const t = calcularTotalesVenta(
      [{ cantidad: 2, precio_unit: 50, costo_unit: 30 }], 16, 0);
    expect(t.gananciaTotal).toBe(40);        // (50 - 30) x 2
    expect(t.gananciaTotal).not.toBe(t.total - t.costoTotal);
  });

  it('un producto sin costo da ganancia igual al precio (margen falso)', () => {
    const t = calcularTotalesVenta(
      [{ cantidad: 1, precio_unit: 80, costo_unit: 0 }], 0, 0);
    expect(t.gananciaTotal).toBe(80);
  });

  it('el descuento del renglon baja subtotal y ganancia', () => {
    const t = calcularTotalesVenta(
      [{ cantidad: 4, precio_unit: 25, costo_unit: 10, descuento: 20 }], 0, 0);
    expect(t.subtotal).toBe(80);
    expect(t.gananciaTotal).toBe(40);
  });

  it('sin renglones da todo en cero', () => {
    const t = calcularTotalesVenta([], 16, 0);
    expect(t).toEqual({ subtotal: 0, descuento: 0, ivaPct: 16, ivaMonto: 0, igtfPct: 0, igtfMonto: 0, total: 0, costoTotal: 0, gananciaTotal: 0 });
  });

  it('sin casilla de IGTF (0 %) el total no cambia', () => {
    const t = calcularTotalesVenta(
      [{ cantidad: 2, precio_unit: 50, costo_unit: 30 }], 16, 10);
    expect(t.igtfPct).toBe(0);
    expect(t.igtfMonto).toBe(0);
    expect(t.total).toBe(104.4);
  });

  it('el IGTF sale de la base, no de base + IVA, y se suma al total', () => {
    const t = calcularTotalesVenta(
      [{ cantidad: 2, precio_unit: 50, costo_unit: 30 }], 16, 10, 3);
    expect(t.ivaMonto).toBe(14.4);   // 90 x 0,16
    expect(t.igtfMonto).toBe(2.7);   // 90 x 0,03 (no 104,4 x 0,03)
    expect(t.total).toBe(107.1);     // 90 + 14,4 + 2,7
  });

  it('nota de entrega sin impuestos: total = base', () => {
    const t = calcularTotalesVenta(
      [{ cantidad: 2, precio_unit: 50, costo_unit: 30 }], 0, 10, 0);
    expect(t.total).toBe(90);
  });

  it('el IGTF no es ganancia', () => {
    const con = calcularTotalesVenta([{ cantidad: 2, precio_unit: 50, costo_unit: 30 }], 16, 0, 3);
    const sin = calcularTotalesVenta([{ cantidad: 2, precio_unit: 50, costo_unit: 30 }], 0, 0, 0);
    expect(con.gananciaTotal).toBe(sin.gananciaTotal);
  });

  it('redondea a dos decimales', () => {
    const t = calcularTotalesVenta(
      [{ cantidad: 3, precio_unit: 3.333, costo_unit: 1.111 }], 16, 0);
    expect(t.subtotal).toBe(10);
    expect(t.ivaMonto).toBe(1.6);
  });
});
