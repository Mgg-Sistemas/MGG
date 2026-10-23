import { describe, expect, it } from 'vitest';
import {
  CONFIG_RETENCION_DEFECTO, calcularIgtf, calcularRetencionIslr, calcularRetencionIva,
  calcularRetencionLocal, comprobanteValido, fechaTasaBcv, formatoComprobante, labelPeriodo, minimoIslr,
  motivoCienTexto, periodoDe, quincenaDe, retieneCienPorCiento, sustraendoIslr,
  totalRetenido, totalesPorImpuesto,
  type ConceptoRetencion, type ConfigRetencion,
  resumenLibro, significadoRetencion, esRecuperable, labelDireccion, totalesPorMoneda,
  puedePracticar, motivoNoPuedePracticar, limiteEntregaComprobante, enBolivares,
} from './retencionesCalculo';

const especial: ConfigRetencion = { ...CONFIG_RETENCION_DEFECTO, esContribuyenteEspecial: true, valorUt: 9 };
const ninguna: ConfigRetencion = { ...CONFIG_RETENCION_DEFECTO, esAgenteRetencionIva: false, esContribuyenteEspecial: false };

const concepto = (over: Partial<ConceptoRetencion>): ConceptoRetencion => ({
  id: 'c', tipo: 'islr', codigo: '001', nombre: 'Honorarios profesionales', sujeto: 'pj_domiciliada',
  porcentaje: 5, basePct: 100, aplicaSustraendo: false, baseMinimaUt: 0,
  fundamento: 'Decreto 1.808', activo: true, orden: 1, ...over,
});

describe('quién retiene · dos marcas separadas (D2)', () => {
  it('sin ninguna de las dos marcas no retiene IVA', () => {
    const r = calcularRetencionIva({ baseImponible: 1000, ivaFactura: 160 }, ninguna);
    expect(r.montoRetenido).toBe(0);
    expect(r.explicacion).toContain('no está marcada como agente de retención de IVA');
  });

  it('el valor por defecto es agente sí y especial no: retiene el IVA', () => {
    expect(CONFIG_RETENCION_DEFECTO.esAgenteRetencionIva).toBe(true);
    expect(CONFIG_RETENCION_DEFECTO.esContribuyenteEspecial).toBe(false);
    expect(calcularRetencionIva({ baseImponible: 1000, ivaFactura: 160 }, CONFIG_RETENCION_DEFECTO).montoRetenido).toBe(120);
  });

  it('el especial retiene IVA aunque la casilla de agente esté apagada', () => {
    const soloEspecial = { ...ninguna, esContribuyenteEspecial: true };
    expect(calcularRetencionIva({ baseImponible: 1000, ivaFactura: 160 }, soloEspecial).montoRetenido).toBe(120);
  });

  it('el agente practica IVA pero no IGTF; el especial practica los dos', () => {
    expect(puedePracticar('iva', CONFIG_RETENCION_DEFECTO)).toBe(true);
    expect(puedePracticar('igtf', CONFIG_RETENCION_DEFECTO)).toBe(false);
    expect(puedePracticar('igtf', especial)).toBe(true);
    expect(motivoNoPuedePracticar('igtf', CONFIG_RETENCION_DEFECTO)).toContain('contribuyente especial');
  });

  it('ISLR, municipal y estadal no dependen de ninguna marca', () => {
    for (const t of ['islr', 'municipal', 'regional'] as const) {
      expect(puedePracticar(t, ninguna)).toBe(true);
      expect(motivoNoPuedePracticar(t, ninguna)).toBeNull();
    }
  });

  it('sin marcas, el motivo del IVA lo explica y remite a «Retención recibida»', () => {
    expect(motivoNoPuedePracticar('iva', ninguna)).toContain('Retención recibida');
  });
});

describe('plazo de entrega y bolívares', () => {
  it('primera quincena: hasta 5 días después del 15', () => {
    expect(limiteEntregaComprobante('2026-10-03')).toBe('2026-10-20');
  });

  it('segunda quincena: hasta el día 5 del mes siguiente', () => {
    expect(limiteEntregaComprobante('2026-10-20')).toBe('2026-11-05');
    expect(limiteEntregaComprobante('2026-12-31')).toBe('2027-01-05');
  });

  it('sin fecha válida no inventa un plazo', () => {
    expect(limiteEntregaComprobante('')).toBe('');
  });

  it('en Bs no hace falta tasa; en divisas sin tasa no hay equivalente', () => {
    expect(enBolivares(120, 'Bs', null)).toBe(120);
    expect(enBolivares(10, 'USD', 36.5)).toBe(365);
    expect(enBolivares(10, 'USD', 0)).toBe(0);
  });
});

describe('retención de IVA · Providencia SNAT/2015/0049', () => {

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

  it('el numeral 3 del art. 5 nombra al proveedor sujeto al 100% según el Portal Fiscal, o no inscrito en el RIF', () => {
    const t = motivoCienTexto({ proveedorNoInscrito: true }) ?? '';
    expect(t).toContain('Portal Fiscal');
    expect(t).toContain('no está inscrito en el RIF');
    expect(t).not.toContain('no coinciden');
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
    // V1/V2: ISLR, ISAE y estadal llevan 10 dígitos continuos; el IVA, 14.
    expect(formatoComprobante('202609', 31, 'islr')).toBe('0000000031');
    expect(formatoComprobante('202609', 31, 'municipal')).toBe('0000000031');
    expect(comprobanteValido('0000000031', 'islr')).toBe(true);
    expect(comprobanteValido('0000000031', 'iva')).toBe(false);
    expect(comprobanteValido('20260900000001', 'regional')).toBe(false);
    expect(comprobanteValido('0000000031')).toBe(true);
  });

  it('el período se lee en palabras', () => {
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
    expect(significadoRetencion('islr', 'practicada')).toMatch(/enteramiento/i);
    expect(significadoRetencion('igtf', 'recibida')).toMatch(/costo/i);
  });

  it('las direcciones se nombran en palabras', () => {
    expect(labelDireccion('recibida')).toBe('Retención recibida');
    expect(labelDireccion('practicada')).toBe('Retención practicada');
  });
});

/* Bs y $ no se suman: 120 Bs + 50 $ no son «170» de nada. El libro da un
   total por moneda, y la moneda es la que trae cada fila (la base no la limita). */
describe('los totales del libro, uno por moneda', () => {
  const filas = [
    { tipo: 'iva' as const, direccion: 'practicada' as const, estado: 'registrada' as const, monto: 120, moneda: 'Bs' },
    { tipo: 'islr' as const, direccion: 'practicada' as const, estado: 'registrada' as const, monto: 50, moneda: 'USD' },
    { tipo: 'iva' as const, direccion: 'recibida' as const, monto: 300, moneda: 'Bs' },
    { tipo: 'islr' as const, direccion: 'practicada' as const, estado: 'registrada' as const, monto: 9999, moneda: 'USD', anulada: true },
  ];

  it('cada moneda lleva su propio total', () => {
    const t = totalesPorMoneda(filas);
    expect(t.map((x) => x.moneda)).toEqual(['Bs', 'USD']);
    expect(t[0].resumen.porEnterar).toBe(120);
    expect(t[0].resumen.aFavor).toBe(300);
    expect(t[1].resumen.porEnterar).toBe(50);   // la anulada de 9999 $ no suma
  });

  it('una moneda que no es Bs ni USD tiene su propio total, no se pierde ni se mezcla', () => {
    const t = totalesPorMoneda([...filas, { tipo: 'iva' as const, direccion: 'recibida' as const, monto: 10, moneda: 'EUR' }]);
    expect(t.map((x) => x.moneda)).toEqual(['Bs', 'EUR', 'USD']);
    expect(t[1].resumen.aFavor).toBe(10);
  });

  it('sin filas no inventa totales', () => {
    expect(totalesPorMoneda([])).toEqual([]);
  });
});

describe('ISLR en divisas · mínimo y sustraendo en Bs', () => {
  const ut43: ConfigRetencion = { ...CONFIG_RETENCION_DEFECTO, valorUt: 43 };
  const pn = concepto({ sujeto: 'pn_residente', porcentaje: 3, aplicaSustraendo: true, baseMinimaUt: 83.3334 });

  it('compara la base en Bs contra el mínimo y resta el sustraendo convertido a $', () => {
    const r = calcularRetencionIslr({ montoPago: 151.54, concepto: pn, moneda: 'USD', tasa: 879.12 }, ut43);
    expect(r.sustraendo).toBe(0.12);
    expect(r.montoRetenido).toBe(4.43);
  });

  it('sin la tasa compararía $ contra Bs: con tasa no se queda en 0', () => {
    expect(calcularRetencionIslr({ montoPago: 151.54, concepto: pn }, ut43).montoRetenido).toBe(0);
    expect(calcularRetencionIslr({ montoPago: 151.54, concepto: pn, moneda: 'USD', tasa: 879.12 }, ut43).montoRetenido).toBeGreaterThan(0);
  });

  it('por debajo del mínimo en Bs no retiene, y lo explica en Bs', () => {
    const r = calcularRetencionIslr({ montoPago: 3, concepto: pn, moneda: 'USD', tasa: 879.12 }, ut43);
    expect(r.montoRetenido).toBe(0);
    expect(r.explicacion).toContain('Bs');
  });

  it('en Bs la tasa no cambia nada', () => {
    const conTasa = calcularRetencionIslr({ montoPago: 100000, concepto: pn, moneda: 'Bs', tasa: 879.12 }, ut43);
    const sinTasa = calcularRetencionIslr({ montoPago: 100000, concepto: pn }, ut43);
    expect(conTasa.montoRetenido).toBe(sinTasa.montoRetenido);
  });
});

describe('fecha de la tasa BCV de una factura', () => {
  it('un día hábil usa su propia fecha', () => {
    expect(fechaTasaBcv('2026-10-16')).toBe('2026-10-16');
  });
  it('sábado y domingo usan la del lunes', () => {
    expect(fechaTasaBcv('2026-10-17')).toBe('2026-10-19');
    expect(fechaTasaBcv('2026-10-18')).toBe('2026-10-19');
  });
  it('cruza el fin de mes', () => {
    expect(fechaTasaBcv('2026-10-31')).toBe('2026-11-02');
  });
  it('sin fecha válida no inventa una', () => {
    expect(fechaTasaBcv('')).toBe('');
    expect(fechaTasaBcv('2026-13-40')).toBe('');
  });
});

describe('compras con devolución · notas de crédito y retenciones anuladas', () => {
  it('una nota de crédito practicada disminuye el monto por enterar', () => {
    const filas = [
      { tipo: 'iva' as const, direccion: 'practicada' as const, estado: 'registrada' as const, monto: 100, tipoDocumento: 'factura' },
      { tipo: 'iva' as const, direccion: 'practicada' as const, estado: 'registrada' as const, monto: 30, tipoDocumento: 'nota_credito' },
    ];
    const r = resumenLibro(filas);
    expect(r.porEnterar).toBe(70);
    expect(r.registros).toBe(2);
  });

  it('una nota de crédito recibida disminuye el crédito a favor', () => {
    const filas = [
      { tipo: 'iva' as const, direccion: 'recibida' as const, monto: 200, tipoDocumento: 'factura' },
      { tipo: 'iva' as const, direccion: 'recibida' as const, monto: 50, tipoDocumento: 'nota_credito' },
    ];
    const r = resumenLibro(filas);
    expect(r.aFavor).toBe(150);
  });

  it('totalesPorImpuesto y totalRetenido deducen notas de crédito', () => {
    const filas = [
      { tipo: 'iva' as const, monto: 500, tipoDocumento: 'factura' },
      { tipo: 'iva' as const, monto: 120, tipoDocumento: 'nota_credito' },
      { tipo: 'islr' as const, monto: 80, tipoDocumento: 'factura' },
      { tipo: 'islr' as const, monto: 200, anulada: true },
    ];
    const tot = totalesPorImpuesto(filas);
    expect(tot.iva).toBe(380);
    expect(tot.islr).toBe(80);
    expect(totalRetenido(filas)).toBe(460);
  });
});

