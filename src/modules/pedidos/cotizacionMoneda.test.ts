import { describe, expect, it } from 'vitest';
import { bsDesdeUsdBcv, factorEuroAUsdBcv, monedaDesdeUsdBcv, usdBcvDesdeMoneda } from './cotizacionMoneda';
import { limpiarDetalleOferta } from './ofertas.repository';

const tasas = { tasa_usd_bcv: 922.56, tasa_eur_bcv: 1012.22 };

describe('cotización en USD o EUR a tasa BCV', () => {
  it('USD a BCV no cambia el importe', () => {
    expect(usdBcvDesdeMoneda(42.92, 'USD', tasas)).toBe(42.92);
    expect(monedaDesdeUsdBcv(42.92, 'USD', tasas)).toBe(42.92);
  });

  it('convierte EUR a USD a BCV con Bs/USD ÷ Bs/EUR', () => {
    const factor = factorEuroAUsdBcv(tasas);
    expect(factor).toBeCloseTo(0.911422, 5);
    expect(usdBcvDesdeMoneda(100, 'EUR', tasas)).toBe(91.1422);
  });

  it('al cambiar de moneda conserva el valor de la oferta', () => {
    const euros = monedaDesdeUsdBcv(100, 'EUR', tasas);
    expect(euros).toBe(109.7186);
    expect(usdBcvDesdeMoneda(euros, 'EUR', tasas)).toBeCloseTo(100, 3);
  });

  it('muestra también los bolívares a tasa BCV', () => {
    expect(bsDesdeUsdBcv(100, tasas)).toBe(92256);
  });

  it('sin tasa del euro no inventa una conversión', () => {
    expect(usdBcvDesdeMoneda(100, 'EUR', { tasa_usd_bcv: 922.56, tasa_eur_bcv: null })).toBe(0);
    expect(monedaDesdeUsdBcv(100, 'EUR', { tasa_usd_bcv: 922.56, tasa_eur_bcv: 0 })).toBe(0);
  });

  it('conserva moneda y tasas dentro del detalle guardado', () => {
    const limpio = limpiarDetalleOferta({
      cotizacion: { moneda: 'EUR', tasa_usd_bcv: 922.56, tasa_eur_bcv: 1012.22 },
    });
    expect(limpio?.cotizacion).toEqual({ moneda: 'EUR', tasa_usd_bcv: 922.56, tasa_eur_bcv: 1012.22 });
  });
});
