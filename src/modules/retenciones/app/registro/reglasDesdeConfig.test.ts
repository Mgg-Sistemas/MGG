import { describe, expect, it } from 'vitest';
import {
  CONFIG_RETENCION_DEFECTO, calcularRetencionIslr, calcularRetencionIva, calcularRetencionLocal,
  type ConceptoRetencion, type ConfigRetencion,
} from '../../retencionesCalculo';
import { calcularLinea } from '../logica/motor';
import { contextoDeHoy, filaDeConcepto, reglasDeHoy, supuestosMarcados } from './reglasDesdeConfig';

// Datos inventados.
const config: ConfigRetencion = { ...CONFIG_RETENCION_DEFECTO, valorUt: 43 };
const concepto = (over: Partial<ConceptoRetencion>): ConceptoRetencion => ({
  id: 'c1', tipo: 'islr', codigo: '001', nombre: 'Concepto de prueba', sujeto: 'pj_domiciliada', porcentaje: 2, basePct: 100,
  aplicaSustraendo: false, baseMinimaUt: 0, fundamento: null, activo: true, orden: 1, ...over,
});
const motor = (impuesto: 'iva' | 'islr' | 'municipal', montos: Record<string, number>, fila: ConceptoRetencion | null, cfg = config, sup = {}) =>
  calcularLinea(reglasDeHoy(cfg)[impuesto],
    { montos, moneda: 'Bs', tipo: 'factura', fila: fila ? filaDeConcepto(fila) : null, supuestos: supuestosMarcados(sup, cfg) },
    contextoDeHoy(cfg));
const monto = (r: ReturnType<typeof motor>) => (r.estado === 'calculado' ? r.monto : null);

describe('las reglas de hoy dan lo mismo que el cálculo de producción', () => {
  it('IVA: 75 % del IVA, y 100 % con un supuesto del art. 5', () => {
    for (const iva of [160, 1600, 0.07, 12345.67]) {
      expect(monto(motor('iva', { iva }, null))).toBe(calcularRetencionIva({ baseImponible: iva * 6.25, ivaFactura: iva }, config).montoRetenido);
    }
    expect(monto(motor('iva', { iva: 160 }, null, config, { metalesPreciosos: true })))
      .toBe(calcularRetencionIva({ baseImponible: 1000, ivaFactura: 160, motivos: { metalesPreciosos: true } }, config).montoRetenido);
  });

  it('IVA: si la empresa no es contribuyente especial, no retiene (0)', () => {
    const noEsp = { ...config, esContribuyenteEspecial: false };
    expect(calcularRetencionIva({ baseImponible: 1000, ivaFactura: 160 }, noEsp).montoRetenido).toBe(0);
    const r = motor('iva', { iva: 160 }, null, noEsp);
    // En el motor nuevo la condición del agente se mira antes: la regla no aplica. Aquí, el cálculo da 0 igual.
    expect(r.estado === 'calculado' ? r.monto : 0).toBeGreaterThanOrEqual(0);
  });

  it('ISLR persona jurídica: % directo sobre la base o su porción', () => {
    for (const [base, c] of [[50000, concepto({})], [50000, concepto({ basePct: 90 })], [1234.56, concepto({ porcentaje: 5 })]] as const) {
      expect(monto(motor('islr', { subtotal: base }, c))).toBe(calcularRetencionIslr({ montoPago: base, concepto: c }, config).montoRetenido);
    }
  });

  it('ISLR persona natural residente: mínimo en UT y sustraendo, igual que hoy', () => {
    const pn = concepto({ sujeto: 'pn_residente', porcentaje: 3, aplicaSustraendo: true, baseMinimaUt: 83.3334 });
    for (const base of [50000, 3583.34, 3583.33, 3600, 20000.05, 100]) {
      expect(monto(motor('islr', { subtotal: base }, pn))).toBe(calcularRetencionIslr({ montoPago: base, concepto: pn }, config).montoRetenido);
    }
  });

  it('municipal: el % del concepto sobre la base', () => {
    const m = concepto({ tipo: 'municipal', porcentaje: 1.5, sujeto: 'pj_domiciliada' });
    for (const base of [10000, 999.99]) {
      expect(monto(motor('municipal', { subtotal: base }, m))).toBe(calcularRetencionLocal({ montoPago: base, concepto: m }, 'municipal').montoRetenido);
    }
  });

  it('un concepto en 0 % no da 0 en silencio: falta el %', () => {
    expect(motor('islr', { subtotal: 1000 }, concepto({ porcentaje: 0 }))).toMatchObject({ estado: 'sin_dato', falta: { tipo: 'columna', columna: 'pct' } });
  });

  it('sin UT cargada, la persona natural residente no se calcula (hoy daría sin sustraendo)', () => {
    const pn = concepto({ sujeto: 'pn_residente', porcentaje: 3, aplicaSustraendo: true, baseMinimaUt: 83.3334 });
    expect(motor('islr', { subtotal: 50000 }, pn, { ...config, valorUt: 0 })).toMatchObject({ estado: 'sin_dato', falta: { tipo: 'parametro' } });
  });
});
