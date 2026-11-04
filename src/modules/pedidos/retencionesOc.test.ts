import { describe, expect, it } from 'vitest';
import { armarRetenciones, etiquetaRetencion, montoRetencion, retencionQueBajaElPago, retencionesDe, totalRetenciones } from './retencionesOc';

describe('retenciones por tipo en la OC (03-11-2026)', () => {
  it('calcula por % del total o por monto fijo, a 2 decimales', () => {
    expect(montoRetencion('pct', 75, 116)).toBe(87);
    expect(montoRetencion('pct', 3, 100.55)).toBe(3.02);
    expect(montoRetencion('monto', 12.345, 999)).toBe(12.35);
    expect(montoRetencion('pct', 0, 100)).toBe(0);
    expect(montoRetencion('pct', 150, 100)).toBe(100);
  });

  it('arma solo las marcadas, en orden IVA, IGTF, ISLR, ISAE', () => {
    const rs = armarRetenciones({ ISLR: { modo: 'pct', valor: 2 }, IVA: { modo: 'monto', valor: 10 }, ISAE: { modo: 'pct', valor: 0 } }, 500);
    expect(rs.map((r) => r.tipo)).toEqual(['IVA', 'ISLR']);
    expect(totalRetenciones(rs)).toBe(20);
  });

  it('solo baja el pago si se retiene ANTES', () => {
    const retenciones = [{ tipo: 'IVA', modo: 'pct', valor: 75, monto: 12 }];
    expect(retencionQueBajaElPago({ retenciones, retencion_momento: 'antes' })).toBe(12);
    expect(retencionQueBajaElPago({ retenciones, retencion_momento: 'despues' })).toBe(0);
    expect(retencionesDe({ retenciones: 'basura' })).toEqual([]);
  });

  it('etiqueta cada retención', () => {
    expect(etiquetaRetencion({ tipo: 'IVA', modo: 'pct', valor: 75 })).toBe('IVA 75 %');
    expect(etiquetaRetencion({ tipo: 'ISLR', modo: 'monto', valor: 5 })).toBe('ISLR (monto fijo)');
  });
});
