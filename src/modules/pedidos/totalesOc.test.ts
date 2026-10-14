import { describe, it, expect } from 'vitest';
import { lineasDeTotal, subtotalItems } from './totalesOc';

/** La OC real de GOMOR: 19 ítems por $100,87, IVA $16,81, total $117,68. */
const GOMOR = {
  items: [
    { cantidad: 2, precio: 0.95 }, { cantidad: 1, precio: 9.2 }, { cantidad: 1, precio: 9.2 },
    { cantidad: 2, precio: 1.05 }, { cantidad: 2, precio: 1.29 }, { cantidad: 1, precio: 2.88 },
    { cantidad: 5, precio: 0.12 }, { cantidad: 2, precio: 3.11 }, { cantidad: 1, precio: 2.41 },
    { cantidad: 1, precio: 2.41 }, { cantidad: 1, precio: 3.18 }, { cantidad: 3, precio: 0.85 },
    { cantidad: 1, precio: 0.56 }, { cantidad: 3, precio: 0.76 }, { cantidad: 2, precio: 0.39 },
    { cantidad: 8, precio: 1.17 }, { cantidad: 1, precio: 36.12 }, { cantidad: 2, precio: 0.69 },
    { cantidad: 3, precio: 1.72 },
  ],
  total: 117.68,
  iva: 16.81,
};

describe('el pie del cuadro de ítems de una OC', () => {
  it('suma los renglones que se compran', () => {
    expect(subtotalItems(GOMOR.items)).toBe(100.87);
  });

  it('un ítem marcado para no comprar no suma', () => {
    expect(subtotalItems([{ cantidad: 2, precio: 10 }, { cantidad: 5, precio: 100, comprar: false }])).toBe(20);
  });

  it('con IVA, el pie explica la diferencia en vez de saltearla', () => {
    expect(lineasDeTotal(GOMOR)).toEqual([
      { etiqueta: 'Subtotal ítems', monto: 100.87 },
      { etiqueta: 'IVA', monto: 16.81 },
      { etiqueta: 'TOTAL', monto: 117.68 },
    ]);
  });

  it('sin impuestos ni descuento, una sola línea alcanza', () => {
    expect(lineasDeTotal({ items: [{ cantidad: 2, precio: 10 }], total: 20 }))
      .toEqual([{ etiqueta: 'TOTAL', monto: 20 }]);
  });

  it('el descuento resta y se ve', () => {
    const l = lineasDeTotal({ items: [{ cantidad: 1, precio: 100 }], total: 90, descuento_obtenido: 10 });
    expect(l).toEqual([
      { etiqueta: 'Subtotal ítems', monto: 100 },
      { etiqueta: 'Descuento', monto: -10 },
      { etiqueta: 'TOTAL', monto: 90 },
    ]);
  });

  it('IVA e IGTF juntos, cada uno en su línea', () => {
    const l = lineasDeTotal({ items: [{ cantidad: 1, precio: 100 }], total: 119, iva: 16, igtf: 3 });
    expect(l.map((x) => x.etiqueta)).toEqual(['Subtotal ítems', 'IVA', 'IGTF', 'TOTAL']);
  });

  it('lo que ningún concepto explica se admite, no se esconde', () => {
    const l = lineasDeTotal({ items: [{ cantidad: 1, precio: 100 }], total: 130, iva: 16 });
    expect(l).toContainEqual({ etiqueta: 'Otros ajustes', monto: 14 });
    expect(l[l.length - 1]).toEqual({ etiqueta: 'TOTAL', monto: 130 });
  });

  it('en una OC consolidada la última línea lleva su código', () => {
    const l = lineasDeTotal({ items: [{ cantidad: 1, precio: 50 }], total: 50 }, 'Subtotal OC-2026-0135');
    expect(l).toEqual([{ etiqueta: 'Subtotal OC-2026-0135', monto: 50 }]);
  });
});

describe('pie con el IVA adentro de los precios y ajuste (14-10-2026)', () => {
  it('Super Home: subtotal con IVA, ajuste con motivo, TOTAL y las dos líneas informativas', () => {
    const l = lineasDeTotal({
      items: [{ cantidad: 1, precio: 2944.07 }], total: 2946.59, iva: 144.69, iva_incluido: true,
      ajuste: 2.52, ajuste_motivo: 'redondeo de la factura 11208',
    });
    expect(l).toEqual([
      { etiqueta: 'Subtotal ítems (con IVA)', monto: 2944.07 },
      { etiqueta: 'Ajuste · redondeo de la factura 11208', monto: 2.52 },
      { etiqueta: 'TOTAL', monto: 2946.59 },
      { etiqueta: 'Base sin IVA (informativo)', monto: 2801.9 },
      { etiqueta: 'IVA (incluido en los precios) (informativo)', monto: 144.69 },
    ]);
  });

  it('con el IVA adentro y sin ajuste, el pie igual dice cuánto IVA lleva', () => {
    const l = lineasDeTotal({ items: [{ cantidad: 1, precio: 116 }], total: 116, iva: 16, iva_incluido: true });
    expect(l.map((x) => x.etiqueta)).toEqual(['Subtotal ítems (con IVA)', 'TOTAL', 'Base sin IVA (informativo)', 'IVA (incluido en los precios) (informativo)']);
    expect(l[2].monto).toBe(100);
  });

  it('un ajuste negativo también se ve', () => {
    const l = lineasDeTotal({ items: [{ cantidad: 1, precio: 100 }], total: 99.7, ajuste: -0.3 });
    expect(l).toEqual([
      { etiqueta: 'Subtotal ítems', monto: 100 },
      { etiqueta: 'Ajuste', monto: -0.3 },
      { etiqueta: 'TOTAL', monto: 99.7 },
    ]);
  });
});
