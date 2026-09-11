import { describe, it, expect } from 'vitest';
import { desglosarOc, ivaContraOferta, avisoDeCuadre } from './cuadreOc';
import type { ItemOrden } from '@/shared/lib/types';

const it_ = (cantidad: number, precio: number, extra: Partial<ItemOrden> = {}) =>
  ({ sku: 'X', nombre: 'X', cantidad, precio, ...extra }) as ItemOrden;

describe('desglosarOc', () => {
  it('una OC sana cuadra', () => {
    const d = desglosarOc({ items: [it_(2, 50)], iva: 16, total: 116 });
    expect(d.base).toBe(100);
    expect(d.esperado).toBe(116);
    expect(d.cuadra).toBe(true);
  });

  it('detecta un total inflado', () => {
    const d = desglosarOc({ items: [it_(1, 100)], total: 150 });
    expect(d.diferencia).toBe(50);
    expect(d.cuadra).toBe(false);
  });

  it('detecta un total al que le falta el IVA', () => {
    // SP-2026-0096-1: base 103,44 · IVA 5,04 · total quedó en 103,44.
    const d = desglosarOc({ items: [it_(1, 103.44)], iva: 5.04, total: 103.44 });
    expect(d.esperado).toBe(108.48);
    expect(d.diferencia).toBe(-5.04);
    expect(d.cuadra).toBe(false);
  });

  it('resta el descuento antes de sumar impuestos', () => {
    const d = desglosarOc({ items: [it_(1, 100)], descuento_obtenido: 10, iva: 16, total: 106 });
    expect(d.esperado).toBe(106);
    expect(d.cuadra).toBe(true);
  });

  it('ignora los ítems destildados: no se compran', () => {
    const d = desglosarOc({ items: [it_(1, 100), it_(1, 500, { comprar: false })], total: 100 });
    expect(d.base).toBe(100);
    expect(d.cuadra).toBe(true);
  });

  it('una diferencia de un centavo es redondeo, no descuadre', () => {
    expect(desglosarOc({ items: [it_(3, 33.333)], total: 100 }).cuadra).toBe(true);
  });

  it('el descuento no deja la base en negativo', () => {
    const d = desglosarOc({ items: [it_(1, 50)], descuento_obtenido: 80, iva: 10, total: 10 });
    expect(d.esperado).toBe(10);
  });

  it('tolera una orden sin ítems ni montos', () => {
    const d = desglosarOc({});
    expect(d).toMatchObject({ base: 0, esperado: 0, guardado: 0, cuadra: true });
  });

  it('el caso SP-2026-0098-1-1 cuadra consigo mismo: el error NO está acá', () => {
    // La orden es internamente coherente (223,65 + 107,20 = 330,85). Lo que está
    // mal es el IVA frente a su oferta, y eso lo atrapa `ivaContraOferta`.
    const d = desglosarOc({ items: [it_(5, 44.73)], iva: 107.2, total: 330.85 });
    expect(d.cuadra).toBe(true);
  });
});

describe('ivaContraOferta', () => {
  it('sin oferta no hay nada que comparar', () => {
    expect(ivaContraOferta({ iva: 16 }, null)).toBeNull();
  });

  it('impuestos iguales no generan aviso', () => {
    expect(ivaContraOferta({ iva: 35.78 }, { iva: 35.78 })).toBeNull();
  });

  it('el caso real: la orden arrastra 107,20 y la oferta dice 35,78', () => {
    const d = ivaContraOferta({ iva: 107.2 }, { iva: 35.78 });
    expect(d?.diferencia).toBe(71.42);
    expect(d?.ivaOferta).toBe(35.78);
  });

  it('también avisa cuando la orden trae MENOS impuesto que la oferta', () => {
    expect(ivaContraOferta({ iva: 0 }, { iva: 20 })?.diferencia).toBe(-20);
  });

  it('suma el IGTF a la comparación', () => {
    expect(ivaContraOferta({ iva: 10, igtf: 5 }, { iva: 10, igtf: 2 })?.diferencia).toBe(3);
  });

  it('un centavo de diferencia no molesta', () => {
    expect(ivaContraOferta({ iva: 16.001 }, { iva: 16 })).toBeNull();
  });
});

describe('avisoDeCuadre', () => {
  it('calla cuando todo cuadra', () => {
    expect(avisoDeCuadre({ items: [it_(1, 100)], total: 100 })).toBeNull();
  });

  it('dice cuánto sobra y de dónde sale el número', () => {
    const msg = avisoDeCuadre({ items: [it_(1, 100)], iva: 16, total: 150 }) ?? '';
    expect(msg).toContain('base 100.00');
    expect(msg).toContain('+ IVA 16.00');
    expect(msg).toContain('116.00');
    expect(msg).toContain('sobran 34.00');
  });

  it('distingue faltan de sobran', () => {
    expect(avisoDeCuadre({ items: [it_(1, 100)], total: 80 })).toContain('faltan 20.00');
  });

  it('no nombra el descuento cuando no hay', () => {
    expect(avisoDeCuadre({ items: [it_(1, 100)], total: 150 })).not.toContain('desc.');
  });
});
