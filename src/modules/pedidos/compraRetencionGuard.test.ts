import { describe, it, expect } from 'vitest';
import { errorMontajeConRetencion } from './compraRetencionGuard';

const declarada = { retencion_finalizada: true, moneda: 'Bs', iva: 160, retencion_pct: 75 };

describe('montar una compra directa con la retención ya finalizada', () => {
  it('sin retención finalizada se puede montar lo que sea', () => {
    expect(errorMontajeConRetencion({ retencion_finalizada: false, moneda: 'Bs', iva: 160, retencion_pct: 75 }, { moneda: 'USD', iva: 0, retencionPct: 0 })).toBeNull();
    expect(errorMontajeConRetencion({}, { moneda: 'Bs', iva: 10, retencionPct: 100 })).toBeNull();
  });
  it('con la misma moneda, IVA y % se puede corregir el resto (precios, factura, nota)', () => {
    expect(errorMontajeConRetencion(declarada, { moneda: 'Bs', iva: 160, retencionPct: 75 })).toBeNull();
    expect(errorMontajeConRetencion(declarada, { moneda: 'Bs', iva: 160.004, retencionPct: 75 })).toBeNull();
  });
  it('rechaza cambiar el IVA, el % o la moneda', () => {
    expect(errorMontajeConRetencion(declarada, { moneda: 'Bs', iva: 0, retencionPct: 75 })).toMatch(/finalizada o declarada/);
    expect(errorMontajeConRetencion(declarada, { moneda: 'Bs', iva: 160, retencionPct: 100 })).toMatch(/finalizada/);
    expect(errorMontajeConRetencion(declarada, { moneda: 'USD', iva: 160, retencionPct: 75 })).toMatch(/moneda/);
    // En dólares el IVA pasa a 0 y la compra saldría del libro: también se rechaza.
    expect(errorMontajeConRetencion(declarada, { moneda: 'USD' })).not.toBeNull();
  });
});
