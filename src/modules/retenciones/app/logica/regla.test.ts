import { describe, expect, it } from 'vitest';
import { ejecutarRegla, type ContextoRegla, type EntradaRegla, type PiezasRegla } from './regla';

// Las reglas de fábrica, como las trae el catálogo de impuestos
const IVA: PiezasRegla = { base: 'iva', pct: 'art5', sustraendo: 'ninguno', minimo: 'ninguno', condicion: 'agente_iva', moneda: 'cualquiera', redondeo: 'paso', cuenta: 'retencion' };
const ISLR: PiezasRegla = { base: 'porcion', pct: 'concepto', sustraendo: 'formula', factor: 83.3334, minimo: 'ut', condicion: 'ninguna', moneda: 'cualquiera', redondeo: 'paso', cuenta: 'retencion' };
const ISAE: PiezasRegla = { base: 'sin_iva', pct: 'actividad', sustraendo: 'ninguno', minimo: 'ninguno', condicion: 'ninguna', moneda: 'cualquiera', redondeo: 'paso', cuenta: 'retencion' };
const IGTF: PiezasRegla = { base: 'pagado', pct: 'fijo', fijo: 3, sustraendo: 'ninguno', minimo: 'ninguno', condicion: 'ninguna', moneda: 'divisas', redondeo: 'paso', cuenta: 'costo' };

const ctx: ContextoRegla = { ut: 43, pctGeneral: 75, pctArt5: 100, agenteIva: true, especial: true };
const entrada = (over: Partial<EntradaRegla> = {}): EntradaRegla => ({
  fecha: '2026-10-14', base: 10000, iva: 1600, pagado: 11600, moneda: 'Bs', motivos100: null, concepto: null, actividad: null, ...over,
});
// Datos ficticios: un concepto de persona natural residente y uno de persona jurídica
const honorariosPn = { codigo: '002', nombre: 'Honorarios profesionales (ejemplo)', porcentaje: 3, basePct: 100, minimoUt: 83.3334, aplicaSustraendo: true };
const serviciosPj = { codigo: '055', nombre: 'Servicios (ejemplo)', porcentaje: 2, basePct: 100, minimoUt: 0, aplicaSustraendo: false };

describe('el motor por piezas · IVA de fábrica', () => {
  it('retiene el % general sobre el IVA de la factura', () => {
    const r = ejecutarRegla(IVA, entrada(), ctx);
    expect(r.estado).toBe('calculado');
    expect(r.monto).toBe(1200);
  });

  it('con un supuesto del art. 5, retiene el 100 % y dice por qué', () => {
    const r = ejecutarRegla(IVA, entrada({ motivos100: { proveedorNoDomiciliado: true } }), ctx);
    expect(r.monto).toBe(1600);
    expect(r.pasos.map((p) => p.valor).join(' ')).toContain('no está domiciliado');
  });

  it('sin el % de IVA vigente no calcula: falta el dato', () => {
    const r = ejecutarRegla(IVA, entrada(), { ...ctx, pctGeneral: null });
    expect(r).toMatchObject({ estado: 'sin_dato', monto: null, falta: 'pct_iva' });
  });

  it('si la empresa no es agente de retención de IVA, da 0 y explica por qué', () => {
    const r = ejecutarRegla(IVA, entrada(), { ...ctx, agenteIva: false });
    expect(r).toMatchObject({ estado: 'calculado', monto: 0, cero: true });
    expect(r.nota).toBe('No se retiene porque la regla exige que la empresa sea agente de retención de IVA y la empresa no es agente de retención de IVA.');
  });

  it('con el régimen sin configurar, el IVA se propone igual', () => {
    expect(ejecutarRegla(IVA, entrada(), { ...ctx, agenteIva: null }).monto).toBe(1200);
  });
});

describe('el motor por piezas · ISLR de fábrica', () => {
  it('persona natural residente: base × % menos el sustraendo (% × UT × 83,3334)', () => {
    const r = ejecutarRegla(ISLR, entrada({ base: 50000, concepto: honorariosPn }), ctx);
    // 50.000 × 3 % = 1.500; sustraendo = 3 % × 43 × 83,3334 = 107,50
    expect(r.monto).toBe(1392.5);
  });

  it('por debajo del mínimo (UT × mínimo del concepto) no retiene', () => {
    const r = ejecutarRegla(ISLR, entrada({ base: 3000, concepto: honorariosPn }), ctx);
    expect(r).toMatchObject({ estado: 'calculado', monto: 0, cero: true, nota: 'No se retiene: la base no llega al mínimo.' });
  });

  it('persona jurídica: el % directo, sin sustraendo ni mínimo', () => {
    expect(ejecutarRegla(ISLR, entrada({ base: 50000, concepto: serviciosPj }), ctx).monto).toBe(1000);
  });

  it('la base puede ser una porción del pago, según el concepto', () => {
    expect(ejecutarRegla(ISLR, entrada({ base: 50000, concepto: { ...serviciosPj, basePct: 50 } }), ctx).monto).toBe(500);
  });

  it('sin concepto vigente no calcula: falta el concepto', () => {
    expect(ejecutarRegla(ISLR, entrada({ concepto: null }), ctx)).toMatchObject({ estado: 'sin_dato', falta: 'concepto' });
  });

  it('sin UT, con mínimo o sustraendo, no calcula: nunca con 0', () => {
    expect(ejecutarRegla(ISLR, entrada({ base: 50000, concepto: honorariosPn }), { ...ctx, ut: null })).toMatchObject({ estado: 'sin_dato', falta: 'ut' });
    expect(ejecutarRegla(ISLR, entrada({ base: 50000, concepto: honorariosPn }), { ...ctx, ut: 0 })).toMatchObject({ estado: 'sin_dato', falta: 'ut' });
  });

  it('sin UT pero sin mínimo ni sustraendo, sí calcula', () => {
    expect(ejecutarRegla(ISLR, entrada({ base: 50000, concepto: serviciosPj }), { ...ctx, ut: null }).monto).toBe(1000);
  });
});

describe('el motor por piezas · ISAE y otros', () => {
  it('ISAE: la alícuota de la actividad sobre la base sin IVA', () => {
    const r = ejecutarRegla(ISAE, entrada({ actividad: { codigo: '3.3.29', descripcion: 'Actividad de ejemplo', porcentaje: 2.5, sujeta: true } }), ctx);
    expect(r.monto).toBe(250);
  });

  it('ISAE sin actividad, o con una que no está sujeta: falta la actividad', () => {
    expect(ejecutarRegla(ISAE, entrada(), ctx)).toMatchObject({ estado: 'sin_dato', falta: 'actividad' });
    expect(ejecutarRegla(ISAE, entrada({ actividad: { codigo: 'x', descripcion: 'x', porcentaje: 0, sujeta: false } }), ctx)).toMatchObject({ falta: 'actividad' });
  });

  it('IGTF: solo los pagos en divisas, y cuenta como costo', () => {
    const r = ejecutarRegla(IGTF, entrada({ moneda: 'USD', pagado: 1000 }), ctx);
    expect(r.monto).toBe(30);
    expect(r.nota).toBe('Cuenta como costo: no se recupera.');
    expect(ejecutarRegla(IGTF, entrada({ moneda: 'Bs' }), ctx)).toMatchObject({ monto: 0, cero: true, nota: 'No aplica: el pago no es en divisas.' });
  });

  it('un impuesto que exige ser contribuyente especial, con el régimen sin configurar, da 0 y lo dice', () => {
    const r = ejecutarRegla({ ...ISAE, pct: 'fijo', fijo: 1, condicion: 'especial' }, entrada(), { ...ctx, especial: null });
    expect(r).toMatchObject({ monto: 0, cero: true });
    expect(r.nota).toContain('el régimen de la empresa está sin configurar');
  });

  it('un cálculo que da 0 sin otra razón se marca como cero, con su nota', () => {
    const r = ejecutarRegla({ ...ISAE, pct: 'fijo', fijo: 0 }, entrada(), ctx);
    expect(r).toMatchObject({ estado: 'calculado', monto: 0, cero: true, nota: 'El cálculo da 0,00 con estos datos.' });
  });

  it('el monto nunca es negativo', () => {
    const r = ejecutarRegla(ISLR, entrada({ base: 3600, concepto: { ...honorariosPn, minimoUt: 0 } }), ctx);
    // 3.600 × 3 % = 108; sustraendo 107,50 → 0,50; con una base menor el sustraendo lo dejaría en negativo
    expect(r.monto).toBe(0.5);
    expect(ejecutarRegla(ISLR, entrada({ base: 1000, concepto: { ...honorariosPn, minimoUt: 0 } }), ctx).monto).toBe(0);
  });

  it('redondeo «paso» redondea la base antes del %; «final», solo el resultado', () => {
    // Un % alto hace visible la diferencia: 10,004 → 10,00 × 250 % = 25,00; sin redondear la base, 25,01
    const fijo = { ...ISAE, pct: 'fijo' as const, fijo: 250 };
    expect(ejecutarRegla({ ...fijo, redondeo: 'paso' }, entrada({ base: 10.004 }), ctx).monto).toBe(25);
    expect(ejecutarRegla({ ...fijo, redondeo: 'final' }, entrada({ base: 10.004 }), ctx).monto).toBe(25.01);
  });
});
