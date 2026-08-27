import { describe, it, expect } from 'vitest';
import { grossDe, recortarOfertaAHija, skusAbsorbiblesPorHija, skusSinCotizar } from './subOc';

// Caso real SP-2026-0116 (27/08/2026).
const TU_PUNTO = {
  precio_total: 25.5,
  precio_efectivo: null,
  descuento: null,
  iva: null,
  igtf: null,
  items: [
    { sku: 'NEW-346', cantidad: 1, precio: 9 },
    { sku: 'NEW-347', cantidad: 1, precio: 8.5 },
    { sku: 'NEW-348', cantidad: 1, precio: 5 },
    { sku: 'NEW-349', cantidad: 1, precio: 3 },
  ],
};
const FERRETERIA_PRINCIPAL = {
  precio_total: 18.43,
  precio_efectivo: null,
  descuento: null,
  iva: 2.95,
  igtf: null,
  items: [
    { sku: 'NEW-346', cantidad: 1, precio: 0 },
    { sku: 'NEW-347', cantidad: 1, precio: 10.52 },
    { sku: 'NEW-348', cantidad: 1, precio: 5.59 },
    { sku: 'NEW-349', cantidad: 1, precio: 2.32 },
  ],
};

describe('grossDe', () => {
  it('suma cantidad × precio ignorando los que no se compran', () => {
    expect(grossDe([{ sku: 'A', cantidad: 2, precio: 1.5 }, { sku: 'B', cantidad: 1, precio: 10, comprar: false }])).toBe(3);
  });
});

describe('skusAbsorbiblesPorHija', () => {
  const madre = ['NEW-346', 'NEW-347', 'NEW-348', 'NEW-349'];

  it('con la hermana viva, la hija solo puede tomar lo suyo', () => {
    expect(skusAbsorbiblesPorHija(['NEW-346'], madre, ['NEW-347', 'NEW-348', 'NEW-349'])).toEqual(['NEW-346']);
  });

  it('cancelada la hermana (SP-2026-0116-2), la -1 puede absorber sus 3 productos', () => {
    expect(skusAbsorbiblesPorHija(['NEW-346'], madre, []).sort()).toEqual(madre);
  });

  it('nunca duplica lo que otra hija viva ya compra', () => {
    expect(skusAbsorbiblesPorHija(['NEW-346'], madre, ['NEW-347']).sort()).toEqual(['NEW-346', 'NEW-348', 'NEW-349']);
  });
});

describe('skusSinCotizar', () => {
  it('detecta los ítems de la hija que la oferta no cotiza o cotiza en $0', () => {
    const hija = [{ sku: 'NEW-346', cantidad: 1, precio: 9 }, { sku: 'NEW-347', cantidad: 1, precio: 8.5 }];
    // FERRETERIA PRINCIPAL cotiza la PIQUETA (NEW-346) en $0 → no sirve para esa hija.
    expect(skusSinCotizar(hija, FERRETERIA_PRINCIPAL.items)).toEqual(['NEW-346']);
    // TU PUNTO cotiza los dos → nada falta.
    expect(skusSinCotizar(hija, TU_PUNTO.items)).toEqual([]);
  });

  it('ignora los ítems que la hija no compra', () => {
    const hija = [{ sku: 'NEW-999', cantidad: 1, precio: 1, comprar: false }];
    expect(skusSinCotizar(hija, TU_PUNTO.items)).toEqual([]);
  });
});

describe('recortarOfertaAHija', () => {
  it('la hija de TU PUNTO con solo la PIQUETA vale $9, no $25,50', () => {
    const r = recortarOfertaAHija(TU_PUNTO, ['NEW-346']);
    expect(r.items.map((i) => i.sku)).toEqual(['NEW-346']);
    expect(r.precio_total).toBe(9);
    expect(r.iva).toBeNull();
    expect(r.fraccion).toBeCloseTo(9 / 25.5, 6);
  });

  it('la hija de FERRETERIA PRINCIPAL con los otros 3 conserva TODO el IVA (fracción 1)', () => {
    const r = recortarOfertaAHija(FERRETERIA_PRINCIPAL, ['NEW-347', 'NEW-348', 'NEW-349']);
    expect(r.precio_total).toBe(18.43);
    expect(r.fraccion).toBe(1);
    expect(r.iva).toBe(2.95);
    expect(r.igtf).toBeNull();
  });

  it('prorratea IVA, IGTF, descuento y efectivo por la fracción de la hija', () => {
    const r = recortarOfertaAHija(
      { ...TU_PUNTO, iva: 4.08, igtf: 0.77, descuento: 2, precio_efectivo: 24 },
      ['NEW-346', 'NEW-348'], // 9 + 5 = 14 de 25.50
    );
    const frac = 14 / 25.5;
    expect(r.precio_total).toBe(14);
    expect(r.iva).toBe(Math.round(4.08 * frac * 100) / 100);
    expect(r.igtf).toBe(Math.round(0.77 * frac * 100) / 100);
    expect(r.descuento).toBe(Math.round(2 * frac * 100) / 100);
    expect(r.precio_efectivo).toBe(Math.round(24 * frac * 100) / 100);
  });

  it('una hija con TODOS los ítems recibe la oferta entera (fracción 1)', () => {
    const r = recortarOfertaAHija({ ...TU_PUNTO, iva: 4.08 }, ['NEW-346', 'NEW-347', 'NEW-348', 'NEW-349']);
    expect(r.precio_total).toBe(25.5);
    expect(r.iva).toBe(4.08);
    expect(r.fraccion).toBe(1);
  });

  it('SKUs que la oferta no cotiza no aparecen y no aportan fracción', () => {
    const r = recortarOfertaAHija(TU_PUNTO, ['NEW-999']);
    expect(r.items).toEqual([]);
    expect(r.precio_total).toBe(0);
    expect(r.fraccion).toBe(0);
    expect(r.iva).toBeNull();
  });

  it('si la oferta no trae precio_total usa la suma de sus ítems como base', () => {
    const r = recortarOfertaAHija({ ...TU_PUNTO, precio_total: 0, iva: 2.55 }, ['NEW-346']);
    expect(r.fraccion).toBeCloseTo(9 / 25.5, 6);
    expect(r.iva).toBe(0.9);
  });

  it('la fracción nunca supera 1 aunque la hija sume más que el precio_total declarado', () => {
    const r = recortarOfertaAHija({ ...TU_PUNTO, precio_total: 10, iva: 1 }, ['NEW-346', 'NEW-347']);
    expect(r.fraccion).toBe(1);
    expect(r.iva).toBe(1);
  });
});
