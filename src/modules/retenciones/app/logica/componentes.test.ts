import { describe, expect, it } from 'vitest';
import { componentesDelDocumento, type DocumentoAnfitrion } from './componentes';
import { calcularLinea } from './motor';
import { CONTEXTO, IVA } from './reglasDePrueba';

const oc = (over: Partial<DocumentoAnfitrion> = {}): DocumentoAnfitrion => ({
  tipo: 'oc', moneda: 'Bs', total: 1160, iva: 160, igtf: null, iva_incluido: false, descuento: null, ...over,
});

describe('los montos del documento: el IVA en blanco se pide (usuario, 16/10 12:19)', () => {
  it('una OC con IVA: subtotal − descuento = total − IVA − IGTF', () => {
    expect(componentesDelDocumento(oc({ total: 1060, descuento: 100 }))).toEqual({
      montos: { total: 1060, iva: 160, igtf: 0, descuento: 100, subtotal: 1000 }, pendientes: [],
    });
  });

  it('el IVA en blanco no es 0: queda como dato que falta, y el motor no calcula', () => {
    const c = componentesDelDocumento(oc({ iva: null }));
    expect(c.montos).toMatchObject({ iva: null, subtotal: null });
    expect(c.pendientes).toEqual(['Falta el IVA de la factura: cargarlo.']);
    const r = calcularLinea(IVA, { montos: c.montos, moneda: 'Bs', tipo: 'factura', fila: null, supuestos: [] }, CONTEXTO);
    expect(r).toMatchObject({ estado: 'sin_dato', falta: { tipo: 'componente', componente: 'iva' } });
  });

  it('precios sin IVA con el 0 escrito: vale 0', () => {
    const c = componentesDelDocumento(oc({ iva: 0, iva_incluido: false, total: 500 }));
    expect(c).toEqual({ montos: { total: 500, iva: 0, igtf: 0, descuento: 0, subtotal: 500 }, pendientes: [] });
  });

  it('precios con el IVA incluido y el IVA en 0 no cuadran: se pide', () => {
    const c = componentesDelDocumento(oc({ iva: 0, iva_incluido: true }));
    expect(c.montos.iva).toBeNull();
    expect(c.pendientes[0]).toContain('el IVA está en 0');
  });

  it('con el IVA incluido en los precios, la base es la de la factura (el ajuste queda dentro)', () => {
    // El ejemplo de la líder: Σ 2.944,07 + ajuste 2,52 = total 2.946,59; IVA 144,69 → base 2.801,90
    const c = componentesDelDocumento(oc({ total: 2946.59, iva: 144.69, iva_incluido: true }));
    expect(c.montos.subtotal).toBeCloseTo(2801.9, 10);
  });

  it('el IGTF en blanco es 0; el servicio directo no tiene IVA: se pide', () => {
    const c = componentesDelDocumento({ tipo: 'servicio_directo', moneda: 'Bs', total: 300, iva: null, igtf: null, iva_incluido: null, descuento: null });
    expect(c.montos).toMatchObject({ igtf: 0, descuento: 0, iva: null });
    expect(c.pendientes).toEqual(['Falta el IVA de la factura: cargarlo.']);
  });
});
