import { describe, expect, it } from 'vitest';
import {
  CONFIG_RETENCION_DEFECTO, calcularIgtf, calcularRetencionIslr, calcularRetencionIva,
  calcularRetencionLocal, comprobanteValido, formatoComprobante, labelPeriodo, minimoIslr,
  motivoCienTexto, periodoDe, quincenaDe, retieneCienPorCiento, sustraendoIslr,
  totalRetenido, totalesPorImpuesto,
  type ConceptoRetencion, type ConfigRetencion,
  resumenLibro, significadoRetencion, esRecuperable, labelDireccion,
} from './retencionesCalculo';

const especial: ConfigRetencion = { ...CONFIG_RETENCION_DEFECTO, esContribuyenteEspecial: true, valorUt: 9 };

const concepto = (over: Partial<ConceptoRetencion>): ConceptoRetencion => ({
  id: 'c', tipo: 'islr', codigo: '001', nombre: 'Honorarios profesionales', sujeto: 'pj_domiciliada',
  porcentaje: 5, basePct: 100, aplicaSustraendo: false, baseMinimaUt: 0,
  fundamento: 'Decreto 1.808', activo: true, orden: 1, ...over,
});

describe('retención de IVA · Providencia SNAT/2015/0049', () => {
  it('quien no es contribuyente especial no retiene IVA', () => {
    const r = calcularRetencionIva({ baseImponible: 1000, ivaFactura: 160 }, CONFIG_RETENCION_DEFECTO);
    expect(r.montoRetenido).toBe(0);
    expect(r.explicacion).toContain('no está marcada como contribuyente especial');
  });

  it('el contribuyente especial retiene el 75% del IVA', () => {
    const r = calcularRetencionIva({ baseImponible: 1000, ivaFactura: 160 }, especial);
    expect(r.porcentaje).toBe(75);
    expect(r.montoRetenido).toBe(120);
    expect(r.impuesto).toBe(160);
    expect(r.alicuota).toBe(16);   // el IVA es el 16% de la base
  });

  it('retiene el 100% cuando la factura no cumple los requisitos', () => {
    const r = calcularRetencionIva({ baseImponible: 1000, ivaFactura: 160, motivos: { facturaNoCumple: true } }, especial);
    expect(r.porcentaje).toBe(100);
    expect(r.montoRetenido).toBe(160);
    expect(r.explicacion).toContain('100%');
  });

  it('cada supuesto del artículo 5 lleva al 100% y se nombra', () => {
    for (const m of [
      { ivaNoDiscriminado: true }, { facturaNoCumple: true }, { proveedorNoInscrito: true },
      { proveedorNoDomiciliado: true }, { metalesPreciosos: true },
    ]) {
      expect(retieneCienPorCiento(m)).toBe(true);
      expect(motivoCienTexto(m)).toBeTruthy();
    }
    expect(retieneCienPorCiento({})).toBe(false);
    expect(retieneCienPorCiento(null)).toBe(false);
  });

  it('una factura sin IVA no genera retención', () => {
    expect(calcularRetencionIva({ baseImponible: 1000, ivaFactura: 0 }, especial).montoRetenido).toBe(0);
  });
});

describe('retención de ISLR · Decreto 1.808', () => {
  it('persona jurídica domiciliada: el porcentaje va directo, sin sustraendo', () => {
    const r = calcularRetencionIslr({ montoPago: 10000, concepto: concepto({ porcentaje: 5 }) }, especial);
    expect(r.montoRetenido).toBe(500);
    expect(r.sustraendo).toBe(0);
  });

  it('contratista persona jurídica: 2% sobre el pago', () => {
    const c = concepto({ nombre: 'Contratistas', porcentaje: 2 });
    expect(calcularRetencionIslr({ montoPago: 50000, concepto: c }, especial).montoRetenido).toBe(1000);
  });

  it('persona natural residente: se le resta el sustraendo', () => {
    // sustraendo = 3% × UT 9 × 83,3334 = 22,50
    const c = concepto({ sujeto: 'pn_residente', porcentaje: 3, aplicaSustraendo: true, baseMinimaUt: 83.3334 });
    const r = calcularRetencionIslr({ montoPago: 10000, concepto: c }, especial);
    expect(r.sustraendo).toBe(22.5);
    expect(r.montoRetenido).toBe(277.5);   // 300 − 22,50
  });

  it('el sustraendo sale de la fórmula % × UT × 83,3334', () => {
    expect(sustraendoIslr(3, 9)).toBe(22.5);
    expect(sustraendoIslr(1, 9)).toBe(7.5);
    expect(sustraendoIslr(3, 0)).toBe(0);   // sin UT cargada no hay sustraendo
  });

  it('por debajo del mínimo no se retiene', () => {
    const c = concepto({ sujeto: 'pn_residente', porcentaje: 3, aplicaSustraendo: true, baseMinimaUt: 83.3334 });
    expect(minimoIslr(c, 9)).toBe(750);
    const r = calcularRetencionIslr({ montoPago: 500, concepto: c }, especial);
    expect(r.montoRetenido).toBe(0);
    expect(r.explicacion).toContain('mínimo');
  });

  it('la retención nunca queda negativa aunque el sustraendo supere el bruto', () => {
    const c = concepto({ sujeto: 'pn_residente', porcentaje: 3, aplicaSustraendo: true, baseMinimaUt: 0 });
    expect(calcularRetencionIslr({ montoPago: 100, concepto: c }, especial).montoRetenido).toBe(0);
  });

  it('cuando la base es una porción del pago, se aplica sobre esa porción', () => {
    // Transporte internacional: 34% sobre el 5% del ingreso bruto.
    const c = concepto({ nombre: 'Transporte internacional', sujeto: 'pj_no_domiciliada', porcentaje: 34, basePct: 5 });
    const r = calcularRetencionIslr({ montoPago: 100000, concepto: c }, especial);
    expect(r.baseImponible).toBe(5000);
    expect(r.montoRetenido).toBe(1700);
  });

  it('sin concepto, con el concepto apagado o en 0% no se calcula', () => {
    expect(calcularRetencionIslr({ montoPago: 1000, concepto: null }, especial).montoRetenido).toBe(0);
    expect(calcularRetencionIslr({ montoPago: 1000, concepto: concepto({ activo: false }) }, especial).montoRetenido).toBe(0);
    expect(calcularRetencionIslr({ montoPago: 1000, concepto: concepto({ porcentaje: 0 }) }, especial).explicacion).toContain('0%');
  });

  it('avisa cuando falta la UT y el concepto lleva sustraendo', () => {
    const c = concepto({ sujeto: 'pn_residente', porcentaje: 3, aplicaSustraendo: true });
    const sinUt = { ...especial, valorUt: 0 };
    expect(calcularRetencionIslr({ montoPago: 10000, concepto: c }, sinUt).explicacion).toContain('UT');
  });
});

describe('retención municipal y estadal', () => {
  it('con la alícuota de la ordenanza cargada, calcula', () => {
    const c = concepto({ tipo: 'municipal', nombre: 'ISAE', sujeto: 'todos', porcentaje: 2 });
    const r = calcularRetencionLocal({ montoPago: 80000, concepto: c }, 'municipal');
    expect(r.montoRetenido).toBe(1600);
  });

  it('en 0% no inventa un número: pide cargar la ordenanza', () => {
    const c = concepto({ tipo: 'municipal', nombre: 'ISAE', porcentaje: 0 });
    const r = calcularRetencionLocal({ montoPago: 80000, concepto: c }, 'municipal');
    expect(r.montoRetenido).toBe(0);
    expect(r.explicacion).toContain('ordenanza');
  });

  it('el timbre estadal remite a la ley del estado', () => {
    const r = calcularRetencionLocal({ montoPago: 1000, concepto: null }, 'regional');
    expect(r.explicacion).toContain('estado');
  });
});

describe('IGTF', () => {
  it('3% sobre el pago en divisas', () => {
    const r = calcularIgtf({ montoPago: 1000, enDivisas: true }, especial);
    expect(r.montoRetenido).toBe(30);
  });

  it('un pago en bolívares no causa IGTF', () => {
    expect(calcularIgtf({ montoPago: 1000, enDivisas: false }, especial).montoRetenido).toBe(0);
  });

  it('respeta el porcentaje configurado (la ley admite entre 2% y 8%)', () => {
    expect(calcularIgtf({ montoPago: 1000, enDivisas: true }, { ...especial, pctIgtf: 2 }).montoRetenido).toBe(20);
  });
});

describe('período y comprobante', () => {
  it('el período es AAAAMM de la fecha', () => {
    expect(periodoDe('2026-09-21')).toBe('202609');
    expect(periodoDe('')).toBe('');
  });

  it('la quincena parte el mes en el día 15', () => {
    expect(quincenaDe('2026-09-01')).toBe(1);
    expect(quincenaDe('2026-09-15')).toBe(1);
    expect(quincenaDe('2026-09-16')).toBe(2);
    expect(quincenaDe('2026-09-30')).toBe(2);
  });

  it('el correlativo es AAAAMM + 8 dígitos', () => {
    expect(formatoComprobante('202609', 1)).toBe('20260900000001');
    expect(formatoComprobante('202609', 1234)).toBe('20260900001234');
    expect(comprobanteValido('20260900000001')).toBe(true);
    expect(comprobanteValido('2026-09-1')).toBe(false);
    expect(comprobanteValido(null)).toBe(false);
  });

  it('el período se lee en criollo', () => {
    expect(labelPeriodo('202609')).toBe('septiembre de 2026');
    expect(labelPeriodo('nada')).toBe('nada');
  });
});

describe('resumen del período', () => {
  const filas = [
    { tipo: 'iva' as const, monto: 120 },
    { tipo: 'iva' as const, monto: 80 },
    { tipo: 'islr' as const, monto: 500 },
    { tipo: 'municipal' as const, monto: 1600 },
    { tipo: 'igtf' as const, monto: 30, anulada: true },
  ];

  it('agrupa por impuesto y descarta las anuladas', () => {
    expect(totalesPorImpuesto(filas)).toEqual({ iva: 200, islr: 500, municipal: 1600, regional: 0, igtf: 0 });
  });

  it('el total tampoco cuenta las anuladas', () => {
    expect(totalRetenido(filas)).toBe(2300);
  });
});

describe('el libro tiene dos direcciones', () => {
  const filas = [
    // Nos retuvieron: anticipo a favor.
    { tipo: 'iva' as const, direccion: 'recibida' as const, monto: 1600 },
    { tipo: 'islr' as const, direccion: 'recibida' as const, monto: 200 },
    // Retuvimos: deuda con el fisco hasta que se declare.
    { tipo: 'islr' as const, direccion: 'practicada' as const, estado: 'registrada' as const, monto: 500 },
    { tipo: 'municipal' as const, direccion: 'practicada' as const, estado: 'declarada' as const, monto: 300 },
    // El IGTF no es ninguna de las dos: es costo.
    { tipo: 'igtf' as const, direccion: 'recibida' as const, monto: 90 },
    // La anulada no cuenta en ningún lado.
    { tipo: 'iva' as const, direccion: 'recibida' as const, monto: 9999, anulada: true },
  ];

  it('lo que nos retuvieron va a favor, sin el IGTF', () => {
    expect(resumenLibro(filas).aFavor).toBe(1800);
  });

  it('el IGTF se suma aparte porque no se recupera', () => {
    expect(resumenLibro(filas).igtfPagado).toBe(90);
    expect(esRecuperable('igtf')).toBe(false);
    expect(esRecuperable('iva')).toBe(true);
  });

  it('lo que retuvimos y no declaramos es deuda; lo declarado sale de ahí', () => {
    const r = resumenLibro(filas);
    expect(r.porEnterar).toBe(500);
    expect(r.enterado).toBe(300);
  });

  it('una anulada no es crédito ni deuda, y se cuenta aparte', () => {
    const r = resumenLibro(filas);
    expect(r.registros).toBe(5);
    expect(r.anulados).toBe(1);
    expect(r.aFavor).not.toBe(1800 + 9999);
  });

  it('el mismo monto significa cosas opuestas según quién retuvo', () => {
    expect(significadoRetencion('islr', 'recibida')).toMatch(/anticipo/i);
    expect(significadoRetencion('islr', 'practicada')).toMatch(/enterarlo/i);
    expect(significadoRetencion('igtf', 'recibida')).toMatch(/costo/i);
  });

  it('las direcciones se nombran en criollo', () => {
    expect(labelDireccion('recibida')).toBe('Nos la practicaron');
    expect(labelDireccion('practicada')).toBe('La practicamos');
  });
});
