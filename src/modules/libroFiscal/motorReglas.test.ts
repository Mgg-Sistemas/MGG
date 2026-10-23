import { describe, expect, it } from 'vitest';
import {
  aplicarTramos, calcularConRegla, condicionesQueFallan, elegirRegla, textoCondicion, textoPaso, validarCondicion, validarPaso,
  type ContextoCalculo, type Regla,
} from './motorReglas';
import {
  CONFIG_RETENCION_DEFECTO, calcularIgtf, calcularRetencionIslr, calcularRetencionIva, calcularRetencionLocal,
  type ConceptoRetencion,
} from './retencionesCalculo';

// Las 5 reglas de arranque de 20-R7 (lo que hoy hace retencionesCalculo.ts). Datos inventados en los montos.
const regla = (impuestoClave: string, nombre: string, condiciones: Regla['condiciones'], pasos: Regla['pasos']): Regla => ({
  impuestoClave, nombre, version: 1, estado: 'en_prueba', desde: '2026-10-16', hasta: null, prioridad: 100, condiciones, pasos,
});
const IVA = regla('IVA', 'IVA', [
  { pieza: 'direccion', operador: 'es', valor: 'practicada' },
  { pieza: 'condicion_agente', operador: 'en', valor: ['agente_retencion', 'contribuyente_especial'] },
], [
  { paso: 1, operacion: 'componer_base', valores: { componentes: [{ campo: 'iva', signo: '+' }] } },
  { paso: 6, operacion: 'retener_pct', valores: { parametro: 'pct_retencion', supuestos: 'pct_retencion_art5' } },
  { paso: 8, operacion: 'redondear', valores: { decimales: 2 } },
]);
const ISLR = regla('ISLR', 'ISLR por concepto', [
  { pieza: 'direccion', operador: 'es', valor: 'practicada' },
  { pieza: 'clasificacion', operador: 'es', valor: { clasificacion: 'islr_conceptos' } },
], [
  { paso: 1, operacion: 'componer_base', valores: { componentes: [{ campo: 'pago', signo: '+' }], porcion: 'clasificacion' } },
  { paso: 2, operacion: 'convertir_moneda', valores: { tasa: 'bcv_fecha_factura' } },
  { paso: 3, operacion: 'comparar_minimo', valores: { desde: 'clasificacion' } },
  { paso: 4, operacion: 'pct_clasificacion', valores: { clasificacion: 'islr_conceptos' } },
  { paso: 5, operacion: 'restar_sustraendo', valores: { desde: 'clasificacion' } },
  { paso: 7, operacion: 'topes', valores: { minimo: 0 } },
  { paso: 8, operacion: 'redondear', valores: { decimales: 2 } },
]);
const ISAE = regla('MUNICIPAL', 'ISAE', [{ pieza: 'direccion', operador: 'es', valor: 'practicada' }], [
  { paso: 1, operacion: 'componer_base', valores: { componentes: [{ campo: 'pago', signo: '+' }] } },
  { paso: 4, operacion: 'pct_parametro', valores: { parametro: 'alicuota' } },
  { paso: 8, operacion: 'redondear', valores: { decimales: 2 } },
]);
const IGTF = regla('IGTF', 'IGTF', [], [
  { paso: 1, operacion: 'componer_base', valores: { componentes: [{ campo: 'pago_divisas', signo: '+' }] } },
  { paso: 4, operacion: 'pct_parametro', valores: { parametro: 'alicuota' } },
  { paso: 8, operacion: 'redondear', valores: { decimales: 2 } },
]);

const ctx = (over: Partial<ContextoCalculo> = {}): ContextoCalculo => ({
  direccion: 'practicada', condicionesAgente: ['agente_retencion'], montos: {}, moneda: 'Bs', tasa: null, ut: 43,
  parametro: () => null, ...over,
});
const concepto = (over: Partial<ConceptoRetencion> = {}): ConceptoRetencion => ({
  id: 'x', tipo: 'islr', codigo: '001', nombre: 'Concepto de prueba', sujeto: 'pn_residente', porcentaje: 3, basePct: 100,
  aplicaSustraendo: true, baseMinimaUt: 83.3334, fundamento: null, activo: true, orden: 1, ...over,
});
const vcPnr = { pct: 3, basePct: 100, minimo: 83.3334, minimoUnidad: 'UT' as const, sustraendoFactor: 83.3334 };
const config = { ...CONFIG_RETENCION_DEFECTO, valorUt: 43 };

describe('las reglas de arranque dan lo mismo que retencionesCalculo.ts', () => {
  it('IVA: 75 % del IVA; con supuesto, el 100 %', () => {
    const p = (k: string) => ({ pct_retencion: 75, pct_retencion_art5: 100 } as Record<string, number>)[k] ?? null;
    const m = calcularConRegla(IVA, ctx({ montos: { iva: 160 }, parametro: p }));
    expect(m.monto).toBe(calcularRetencionIva({ baseImponible: 1000, ivaFactura: 160 }, config).montoRetenido);
    expect(m.monto).toBe(120);
    const s = calcularConRegla(IVA, ctx({ montos: { iva: 160 }, parametro: p, supuesto: true }));
    expect(s.monto).toBe(calcularRetencionIva({ baseImponible: 1000, ivaFactura: 160, motivos: { ivaNoDiscriminado: true } }, config).montoRetenido);
    expect(s.foto.pasos.map((x) => x.paso)).toEqual([1, 6, 8]);
  });

  it('ISLR persona natural residente: mínimo en UT y sustraendo, en Bs', () => {
    const m = calcularConRegla(ISLR, ctx({ montos: { pago: 10000 }, valorClasificacion: vcPnr }));
    const hoy = calcularRetencionIslr({ montoPago: 10000, concepto: concepto() }, config);
    expect(m.monto).toBe(hoy.montoRetenido);
    expect(m.sustraendo).toBe(hoy.sustraendo);
    expect(m.monto).toBe(192.5);
  });

  it('ISLR en dólares: el mínimo se compara en Bs y el sustraendo vuelve a dólares', () => {
    const m = calcularConRegla(ISLR, ctx({ montos: { pago: 100 }, moneda: 'USD', tasa: 40, valorClasificacion: vcPnr }));
    const hoy = calcularRetencionIslr({ montoPago: 100, concepto: concepto(), moneda: 'USD', tasa: 40 }, config);
    expect(m.monto).toBe(hoy.montoRetenido);
    expect(m.baseBs).toBe(4000);
    expect(m.montoBs).toBe(Math.round(m.monto * 40 * 100) / 100);
  });

  it('ISLR bajo el mínimo: no se retiene, igual que hoy, y la foto dice por qué', () => {
    const m = calcularConRegla(ISLR, ctx({ montos: { pago: 3000 }, valorClasificacion: vcPnr }));
    expect(calcularRetencionIslr({ montoPago: 3000, concepto: concepto() }, config).montoRetenido).toBe(0);
    expect(m.aplica).toBe(false);
    expect(m.motivo).toMatch(/no llega al mínimo/);
    expect(m.foto.pasos.map((x) => x.paso)).toEqual([1, 2, 3]);
  });

  it('ISLR persona jurídica (2 %, porción de la base): igual que hoy', () => {
    const m = calcularConRegla(ISLR, ctx({ montos: { pago: 5000 }, valorClasificacion: { pct: 2, basePct: 90, minimo: null, minimoUnidad: null, sustraendoFactor: null } }));
    const hoy = calcularRetencionIslr({ montoPago: 5000, concepto: concepto({ porcentaje: 2, basePct: 90, aplicaSustraendo: false, baseMinimaUt: 0 }) }, config);
    expect(m.monto).toBe(hoy.montoRetenido);
    expect(m.base).toBe(4500);
  });

  it('ISAE e IGTF: % del parámetro sobre el pago', () => {
    const isae = calcularConRegla(ISAE, ctx({ montos: { pago: 1000 }, parametro: (k) => (k === 'alicuota' ? 1 : null) }));
    expect(isae.monto).toBe(calcularRetencionLocal({ montoPago: 1000, concepto: concepto({ tipo: 'municipal', porcentaje: 1 }) }, 'municipal').montoRetenido);
    const igtf = calcularConRegla(IGTF, ctx({ montos: { pago_divisas: 100 }, parametro: (k) => (k === 'alicuota' ? 3 : null) }));
    expect(igtf.monto).toBe(calcularIgtf({ montoPago: 100, enDivisas: true }, config).montoRetenido);
  });
});

describe('condiciones', () => {
  it('IVA solo si la empresa es agente o especial, y practicada', () => {
    expect(condicionesQueFallan(IVA, ctx())).toEqual([]);
    expect(condicionesQueFallan(IVA, ctx({ condicionesAgente: [] }))).toHaveLength(1);
    expect(condicionesQueFallan(IVA, ctx({ direccion: 'sufrida' }))).toHaveLength(1);
  });

  it('clasificación por clave y códigos; monto mínimo en UT sobre el pago en Bs', () => {
    const r: Regla = { ...ISAE, condiciones: [
      { pieza: 'clasificacion', operador: 'es', valor: { clasificacion: 'isae_x', codigos: ['1.01'] } },
      { pieza: 'monto_minimo', operador: 'es', valor: { monto: 10, unidad: 'UT', sobre: 'pago' } },
    ] };
    expect(condicionesQueFallan(r, ctx({ clasificacion: { clave: 'isae_x', codigo: '1.01' }, montos: { pago: 430 } }))).toEqual([]);
    expect(condicionesQueFallan(r, ctx({ clasificacion: { clave: 'isae_x', codigo: '1.02' }, montos: { pago: 430 } }))).toHaveLength(1);
    expect(condicionesQueFallan(r, ctx({ clasificacion: { clave: 'isae_x', codigo: '1.01' }, montos: { pago: 400 } }))).toHaveLength(1);
  });

  it('un dato que falta no cumple; elegirRegla toma la primera por prioridad', () => {
    const conSujeto: Regla = { ...ISAE, nombre: 'A', prioridad: 10, condiciones: [{ pieza: 'sujeto', operador: 'es', valor: 'PNR' }] };
    const general: Regla = { ...ISAE, nombre: 'B', prioridad: 50 };
    expect(condicionesQueFallan(conSujeto, ctx())).toEqual(['Falta el dato: Tipo de proveedor.']);
    expect(elegirRegla([general, conSujeto], ctx({ sujeto: 'PNR' }))?.nombre).toBe('A');
    expect(elegirRegla([general, conSujeto], ctx({ sujeto: 'PJD' }))?.nombre).toBe('B');
  });
});

describe('validadores (los mismos que la base) y textos', () => {
  it('condiciones', () => {
    expect(validarCondicion({ pieza: 'sujeto', operador: 'es', valor: 'XX' })).toMatch(/admite/);
    expect(validarCondicion({ pieza: 'sujeto', operador: 'en', valor: [] })).toMatch(/lista/);
    expect(validarCondicion({ pieza: 'monto_minimo', operador: 'es', valor: { monto: 1, unidad: 'UT', sobre: 'x' } })).toMatch(/monto_minimo/);
    expect(validarCondicion({ pieza: 'direccion', operador: 'es', valor: 'practicada' })).toBeNull();
  });

  it('pasos: la operación tiene que ser de su paso', () => {
    expect(validarPaso({ paso: 4, operacion: 'redondear', valores: {} })).toMatch(/el paso 4 admite/);
    expect(validarPaso({ paso: 8, operacion: 'redondear', valores: { decimales: 5 } })).toMatch(/0 a 4/);
    expect(validarPaso({ paso: 1, operacion: 'componer_base', valores: { componentes: [{ campo: 'nada', signo: '+' }] } })).toMatch(/campo/);
    for (const p of [...IVA.pasos, ...ISLR.pasos, ...ISAE.pasos, ...IGTF.pasos]) expect(validarPaso(p)).toBeNull();
  });

  it('textos para la pantalla', () => {
    expect(textoCondicion(IVA.condiciones[1])).toBe('condicion agente es uno de agente_retencion, contribuyente_especial');
    expect(textoPaso(ISLR.pasos[0])).toBe('Base · +pago × porción de la clasificación');
  });
});

describe('tarifa por tramos', () => {
  const tramos = [
    { desdeMonto: 0, hastaMonto: 1000, pct: 6, sustraendo: 0 },
    { desdeMonto: 1000, hastaMonto: 1500, pct: 9, sustraendo: 30 },
    { desdeMonto: 1500, hastaMonto: null, pct: 12, sustraendo: 75 },
  ];
  it('el tramo según la base en UT; el sustraendo vuelve a Bs', () => {
    expect(aplicarTramos(tramos, 'UT', 43 * 1200, 43)).toEqual({ pct: 9, sustraendoBs: 1290 });
    expect(aplicarTramos(tramos, 'UT', 43 * 500, 43)).toEqual({ pct: 6, sustraendoBs: 0 });
    expect(aplicarTramos(tramos, 'UT', 1000, null)).toBeNull();
  });

  it('una regla con «tramos»: % y sustraendo del tramo', () => {
    const r: Regla = { ...ISAE, pasos: [
      { paso: 1, operacion: 'componer_base', valores: { componentes: [{ campo: 'pago', signo: '+' }] } },
      { paso: 4, operacion: 'tramos', valores: { tarifa: 'islr_tarifa_2' } },
      { paso: 8, operacion: 'redondear', valores: { decimales: 2 } },
    ] };
    const m = calcularConRegla(r, ctx({ montos: { pago: 43 * 1200 }, tarifa: () => ({ tramos, unidad: 'UT' }) }));
    expect(m.pct).toBe(9);
    expect(m.monto).toBe(Math.round((43 * 1200 * 0.09 - 1290) * 100) / 100);
  });
});
