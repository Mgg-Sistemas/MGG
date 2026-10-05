import { describe, expect, it } from 'vitest';
import {
  cambiarPresentacion, cantidadCompraPara, cantidadEnUso, costoPorUnidadDeUso, factorDe,
  presentacionSugerida, textoCantidadCompra, textoEquivalencia, usaUnidadCompra,
} from './unidadCompra';

const azucar = { unidad: 'KILOGRAMO', unidad_compra: 'BULTO', factor_compra: 50 };
const viejo = { unidad: 'KILOGRAMO' };

describe('unidad de compra vs unidad de uso', () => {
  it('sin unidad de compra todo queda como antes (factor 1)', () => {
    expect(factorDe(viejo)).toBe(1);
    expect(usaUnidadCompra(viejo)).toBe(false);
    expect(cantidadEnUso(viejo, 500)).toBe(500);
    expect(costoPorUnidadDeUso(viejo, 0.8)).toBe(0.8);
    expect(textoCantidadCompra(viejo, 500)).toBe('500 KILOGRAMO');
  });
  it('factor inválido o sin unidad cuenta como 1', () => {
    expect(factorDe({ unidad_compra: 'BULTO', factor_compra: 0 })).toBe(1);
    expect(factorDe({ unidad_compra: '', factor_compra: 50 })).toBe(1);
  });
  it('10 bultos de 50 kg entran como 500 kg y el costo se reparte', () => {
    expect(cantidadEnUso(azucar, 10)).toBe(500);
    expect(costoPorUnidadDeUso(azucar, 40)).toBe(0.8);
    expect(textoCantidadCompra(azucar, 10)).toBe('10 BULTO (= 500 KILOGRAMO)');
    expect(textoEquivalencia(azucar)).toBe('1 BULTO = 50 KILOGRAMO');
  });
  it('el total en dinero no cambia: 10 × $40 = 500 × $0,80', () => {
    expect(10 * 40).toBeCloseTo(cantidadEnUso(azucar, 10) * costoPorUnidadDeUso(azucar, 40), 6);
  });
  it('se piden bultos enteros, redondeando hacia arriba', () => {
    expect(cantidadCompraPara(500, 50)).toBe(10);
    expect(cantidadCompraPara(520, 50)).toBe(11);
    expect(cantidadCompraPara(7.5, 1)).toBe(7.5);
  });
  it('cambiar de proveedor (bulto 50 → saco 25) conserva lo pedido en kg', () => {
    const r = cambiarPresentacion({ ...azucar, cantidad: 10 }, { unidad_compra: 'saco', factor_compra: 25 });
    expect(r).toEqual({ cantidad: 20, unidad_compra: 'SACO', factor_compra: 25 });
    const vuelta = cambiarPresentacion({ ...azucar, ...r }, { unidad_compra: null, factor_compra: null });
    expect(vuelta).toEqual({ cantidad: 500, unidad_compra: null, factor_compra: null });
  });
  it('la presentación del proveedor manda sobre la de la ficha', () => {
    expect(presentacionSugerida({ unidad_compra: 'saco', factor_compra: 25 }, { unidad_compra: 'BULTO', unidades_empaque: 50 }))
      .toEqual({ unidad_compra: 'SACO', factor_compra: 25 });
    expect(presentacionSugerida(null, { unidad_compra: 'bulto', unidades_empaque: 50 }))
      .toEqual({ unidad_compra: 'BULTO', factor_compra: 50 });
    expect(presentacionSugerida(null, { unidad_compra: null, unidades_empaque: 50 })).toBeNull();
  });
  it('misma unidad con factor 1 no es conversión', () => {
    expect(usaUnidadCompra({ unidad: 'GALON', unidad_compra: 'galon', factor_compra: 1 })).toBe(false);
    expect(usaUnidadCompra({ unidad: 'GALON', unidad_compra: 'CUÑETE', factor_compra: 5 })).toBe(true);
  });
});
