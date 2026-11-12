import { describe, expect, it } from 'vitest';
import { ajusteInicial, cambiarModo, faltaFactor, precioUsoDe, renglonReparto, textoConversion, type RenglonBase } from './repartoRenglon';

const op: RenglonBase = { cantidad: 5, unidad: 'GALON' };
const pailas: RenglonBase = { cantidad: 2, unidad: 'GALON', unidad_compra: 'PAILA', factor_compra: 5 };

describe('asignar proveedores · renglón con la unidad cotizada', () => {
  it('mantiene lo cotizado: 2 PAILA × $230 = $460 (no 5 GALON × $230)', () => {
    const aj = ajusteInicial(op, pailas);
    const r = renglonReparto(op, pailas, aj, 230);
    expect(aj.modo).toBe('cotizada');
    expect(r).toMatchObject({ cantidad: 2, precio: 230, unidad_compra: 'PAILA', factor_compra: 5, unidadMostrada: 'PAILA', escala: 1 });
    expect(r.cantidad * r.precio).toBe(460);
    expect(precioUsoDe(aj, 230)).toBe(46);
    expect(textoConversion(r, 'GALON')).toBe('2 PAILA = 10 GALON');
  });

  it('pasar a la unidad del inventario convierte cantidad y precio (mismo total)', () => {
    const aj = cambiarModo(ajusteInicial(op, pailas), 'uso');
    const r = renglonReparto(op, pailas, aj, 230);
    expect(r).toMatchObject({ cantidad: 10, precio: 46, unidad_compra: null, factor_compra: null, unidadMostrada: 'GALON' });
    expect(r.escala).toBeCloseTo(0.2, 10);
    expect(r.cantidad * r.precio).toBe(460);
  });

  it('otra presentación conserva el precio por unidad de uso', () => {
    let aj = cambiarModo(ajusteInicial(op, pailas), 'uso');
    aj = cambiarModo({ ...aj, otraUnidad: 'tambor', otraFactor: 55 }, 'otra');
    const r = renglonReparto(op, pailas, aj, 230);
    expect(r).toMatchObject({ unidad_compra: 'TAMBOR', factor_compra: 55, precio: 2530 });
    expect(r.cantidad).toBeCloseTo(10 / 55, 3);
  });

  it('cotizado en PAILA sin factor: avisa, y al indicarlo queda en la sub-OC', () => {
    const sinFactor: RenglonBase = { cantidad: 2, unidad: 'GALON', unidad_compra: 'PAILA', factor_compra: null };
    const aj = ajusteInicial(op, sinFactor);
    expect(aj.modo).toBe('cotizada');
    expect(faltaFactor(aj)).toBe(true);
    const con = { ...aj, factorCotizada: 5 };
    expect(faltaFactor(con)).toBe(false);
    expect(renglonReparto(op, sinFactor, con, 230)).toMatchObject({ cantidad: 2, unidad_compra: 'PAILA', factor_compra: 5, precio: 230 });
  });

  it('misma unidad (o sinónimo): sin conversión, cantidad cotizada y precio de la oferta', () => {
    const igual: RenglonBase = { cantidad: 4, unidad: 'GALON', unidad_compra: 'GAL', factor_compra: null };
    const aj = ajusteInicial(op, igual);
    expect(aj.modo).toBe('uso');
    expect(renglonReparto(op, igual, aj, 50)).toMatchObject({ cantidad: 4, precio: 50, unidad_compra: null });
  });

  it('sin cantidad cotizada: la pedida llevada a la unidad cotizada; y la cantidad se edita', () => {
    const aj = ajusteInicial(op, { ...pailas, cantidad: 0 });
    expect(aj.cantidad).toBe(1);
    expect(renglonReparto(op, pailas, { ...aj, cantidad: 3 }, 230)).toMatchObject({ cantidad: 3, precio: 230 });
  });
});
