import { describe, it, expect } from 'vitest';
import { etiquetaAjuste, etiquetaIva, ivaDesdePorcentaje, ivaQueSuma, porcentajeDesdeIva, totalDesdePartes } from './impuestosOc';

describe('total a pagar: IVA incluido en los precios y ajuste (14-10-2026)', () => {
  it('sin bandera, el IVA suma como siempre', () => {
    expect(totalDesdePartes({ subtotal: 100, iva: 16 })).toBe(116);
    expect(totalDesdePartes({ subtotal: 100, descuento: 10, iva: 14.4, igtf: 3 })).toBe(107.4);
  });

  it('con IVA incluido, el IVA se guarda pero NO suma', () => {
    expect(ivaQueSuma({ iva: 144.69, iva_incluido: true })).toBe(0);
    expect(ivaQueSuma({ iva: 144.69, iva_incluido: false })).toBe(144.69);
    expect(totalDesdePartes({ subtotal: 2944.07, iva: 144.69, iva_incluido: true })).toBe(2944.07);
  });

  it('Super Home, factura 11208: renglones 2.944,07 con IVA adentro + 2,52 de redondeo = 2.946,59', () => {
    expect(totalDesdePartes({ subtotal: 2944.07, iva: 144.69, iva_incluido: true, ajuste: 2.52 })).toBe(2946.59);
  });

  it('el ajuste puede ser negativo y el descuento no deja la base en negativo', () => {
    expect(totalDesdePartes({ subtotal: 100, ajuste: -0.3 })).toBe(99.7);
    expect(totalDesdePartes({ subtotal: 50, descuento: 80, iva: 10 })).toBe(10);
  });

  it('el % de IVA se calcula sobre la base neta cuando los precios lo traen adentro', () => {
    expect(ivaDesdePorcentaje(116, 16, true)).toBe(16);
    expect(ivaDesdePorcentaje(100, 16, false)).toBe(16);
    expect(porcentajeDesdeIva(116, 16, true)).toBe(16);
    expect(porcentajeDesdeIva(100, 16, false)).toBe(16);
    expect(ivaDesdePorcentaje(0, 16, true)).toBe(0);
    expect(porcentajeDesdeIva(10, 10, true)).toBe(0);
  });

  it('etiquetas', () => {
    expect(etiquetaIva(true)).toBe('IVA (incluido en los precios)');
    expect(etiquetaIva(false)).toBe('IVA');
    expect(etiquetaAjuste(' redondeo de la factura ')).toBe('Ajuste · redondeo de la factura');
    expect(etiquetaAjuste(null)).toBe('Ajuste');
  });
});
