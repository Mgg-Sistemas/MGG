import { describe, expect, it } from 'vitest';
import {
  armarRetenciones,
  baseParaTipoRetencion,
  etiquetaRetencion,
  impuestosEnBs,
  impuestosEnUsd,
  montoImpuestoEnBs,
  montoRetencion,
  retencionQueBajaElPago,
  retencionesDe,
  totalRetenciones,
  type BasesRetencionOc,
} from './retencionesOc';

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

  it('guarda en qué moneda se paga cada impuesto y separa los de Bs (08-11-2026)', () => {
    const rs = armarRetenciones({ IVA: { modo: 'pct', valor: 75, moneda_pago: 'Bs' }, ISLR: { modo: 'monto', valor: 2, moneda_pago: 'USD' } }, 100);
    expect(rs).toEqual([
      { tipo: 'IVA', modo: 'pct', valor: 75, monto: 75, moneda_pago: 'Bs' },
      { tipo: 'ISLR', modo: 'monto', valor: 2, monto: 2 },
    ]);
    const leidas = retencionesDe({ retenciones: rs });
    expect(impuestosEnBs(leidas).map((r) => r.tipo)).toEqual(['IVA']);
    expect(impuestosEnUsd(leidas).map((r) => r.tipo)).toEqual(['ISLR']);
    // Las de antes (sin dato) se pagan en $.
    expect(impuestosEnBs(retencionesDe({ retenciones: [{ tipo: 'IVA', modo: 'pct', valor: 75, monto: 12 }] }))).toEqual([]);
  });

  it('monto del impuesto en Bs: × tasa en OC en $, tal cual en OC en Bs, null sin tasa', () => {
    expect(montoImpuestoEnBs({ monto: 12 }, 'USD', 36.5)).toBe(438);
    expect(montoImpuestoEnBs({ monto: 12 }, 'Bs', 36.5)).toBe(12);
    expect(montoImpuestoEnBs({ monto: 12 }, 'USD', 0)).toBeNull();
  });

  it('etiqueta cada retención', () => {
    expect(etiquetaRetencion({ tipo: 'IVA', modo: 'pct', valor: 75 })).toBe('IVA 75 %');
    expect(etiquetaRetencion({ tipo: 'ISLR', modo: 'monto', valor: 5 })).toBe('ISLR (monto fijo)');
  });

  it('aplica las retenciones sobre sus bases legales correspondientes (IVA sobre iva, ISLR/ISAE sobre base imponible, IGTF sobre total)', () => {
    const bases: BasesRetencionOc = {
      total: 116,
      baseImponible: 100,
      iva: 16,
    };
    expect(baseParaTipoRetencion('IVA', bases)).toBe(16);
    expect(baseParaTipoRetencion('ISLR', bases)).toBe(100);
    expect(baseParaTipoRetencion('ISAE', bases)).toBe(100);
    expect(baseParaTipoRetencion('IGTF', bases)).toBe(116);

    const rs = armarRetenciones({
      IVA: { modo: 'pct', valor: 75 },   // 75% de 16 = 12
      ISLR: { modo: 'pct', valor: 2 },   // 2% de 100 = 2
      ISAE: { modo: 'pct', valor: 1 },   // 1% de 100 = 1
      IGTF: { modo: 'pct', valor: 3 },   // 3% de 116 = 3.48
    }, bases);

    expect(rs).toEqual([
      { tipo: 'IVA', modo: 'pct', valor: 75, monto: 12 },
      { tipo: 'IGTF', modo: 'pct', valor: 3, monto: 3.48 },
      { tipo: 'ISLR', modo: 'pct', valor: 2, monto: 2 },
      { tipo: 'ISAE', modo: 'pct', valor: 1, monto: 1 },
    ]);
    expect(totalRetenciones(rs)).toBe(18.48);
  });
});
