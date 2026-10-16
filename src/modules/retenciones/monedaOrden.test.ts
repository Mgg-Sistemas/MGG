import { describe, expect, it } from 'vitest';
import { monedaDeOrden } from './monedaOrden';

describe('la moneda de una OC en Retenciones sale de la orden, no se supone $', () => {
  it('una OC en Bs es Bs', () => {
    expect(monedaDeOrden('Bs')).toEqual({ moneda: 'Bs', aviso: null });
    expect(monedaDeOrden(' bs ')).toEqual({ moneda: 'Bs', aviso: null });
    expect(monedaDeOrden('VES')).toEqual({ moneda: 'Bs', aviso: null });
  });

  it('una OC en USD, o sin moneda (el valor por defecto de la orden), es USD', () => {
    expect(monedaDeOrden('USD')).toEqual({ moneda: 'USD', aviso: null });
    expect(monedaDeOrden(null)).toEqual({ moneda: 'USD', aviso: null });
    expect(monedaDeOrden('')).toEqual({ moneda: 'USD', aviso: null });
  });

  it('otra moneda se muestra como $, pero avisa en vez de pasar en silencio', () => {
    const r = monedaDeOrden('COP');
    expect(r.moneda).toBe('USD');
    expect(r.aviso).toBe('La OC indica la moneda «COP», que Retenciones no maneja (solo Bs y USD): el monto se muestra como $. Revisar la moneda de la OC.');
  });
});
