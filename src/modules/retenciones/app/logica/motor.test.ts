import { describe, expect, it } from 'vitest';
import { calcularLinea, redondear, type ContextoCalculo, type EntradaLinea, type ResultadoCalculo } from './motor';
import {
  ACTIVIDAD, COMISIONES_PNR, CONTEXTO, HONORARIOS_PNR, IGTF, ISAE, ISLR_PJND, ISLR_PNR, IVA, PORCION_PJD, SERVICIOS_PJD, SERVICIOS_PJND, TASA_USD,
} from './reglasDePrueba';
import type { VersionRegla } from './regla';

const linea = (over: Partial<EntradaLinea> = {}): EntradaLinea => ({
  montos: {}, moneda: 'Bs', tipo: 'factura', fila: null, supuestos: [], ...over,
});
const monto = (r: ResultadoCalculo) => (r.estado === 'calculado' ? r.monto : null);
const pasos = (r: ResultadoCalculo) => r.foto.pasos.map((p) => p.paso);

describe('IVA, como dato: el % del IVA de la factura (75 o el del supuesto)', () => {
  it('retiene el 75 % del IVA de la factura', () => {
    const r = calcularLinea(IVA, linea({ montos: { subtotal: 10000, iva: 1600 } }), CONTEXTO);
    expect(monto(r)).toBe(1200);
    expect(pasos(r)).toEqual(['base', 'retiene', 'topes', 'redondeo']);
  });

  it('con un supuesto del 100 % marcado, retiene todo y la foto guarda cuál', () => {
    const r = calcularLinea(IVA, linea({ montos: { iva: 1600 }, supuestos: [{ id: 's-3', texto: 'Proveedor no inscrito', pct: 100 }] }), CONTEXTO);
    expect(monto(r)).toBe(1600);
    expect(r.foto.valores).toMatchObject({ supuestos: ['s-3'], pct_supuesto: 100 });
  });

  it('con varios supuestos marcados, toma el mayor %', () => {
    const r = calcularLinea(IVA, linea({ montos: { iva: 1000 }, supuestos: [{ id: 'a', texto: 'a', pct: 80 }, { id: 'b', texto: 'b', pct: 100 }] }), CONTEXTO);
    expect(monto(r)).toBe(1000);
    expect(r.foto.valores.supuestos).toEqual(['a', 'b']);
  });

  it('la nota de crédito calcula en positivo y resta: el signo va después del paso 8', () => {
    const r = calcularLinea(IVA, linea({ tipo: 'nc', montos: { iva: 160 } }), CONTEXTO);
    expect(r).toMatchObject({ estado: 'calculado', monto: -120, magnitud: 120 });
    expect(r.foto.signo).toBe(-1);
  });

  it('una factura en $ se lleva a Bs con la tasa de la fecha de la factura, y la foto guarda la tasa', () => {
    const r = calcularLinea(IVA, linea({ moneda: 'USD', montos: { iva: 100 } }), { ...CONTEXTO, tasa: TASA_USD });
    expect(monto(r)).toBe(3000);
    expect(r.foto.valores.tasas).toEqual([TASA_USD]);
  });

  it('sin la tasa de la moneda del documento no calcula: falta la tasa', () => {
    const r = calcularLinea(IVA, linea({ moneda: 'USD', montos: { iva: 100 } }), CONTEXTO);
    expect(r).toMatchObject({ estado: 'sin_dato', falta: { tipo: 'tasa', moneda: 'USD' } });
  });
});

describe('ISLR de persona natural residente, como dato: porción, mínimo en UT, % y sustraendo', () => {
  it('base × % menos el sustraendo (% × UT × 83,3334)', () => {
    const r = calcularLinea(ISLR_PNR, linea({ montos: { subtotal: 50000 }, fila: HONORARIOS_PNR }), CONTEXTO);
    // 50.000 × 3 % = 1.500; sustraendo = 3 % × 43 × 83,3334 = 107,50; 1.500 − 107,50 = 1.392,50
    expect(monto(r)).toBe(1392.5);
    expect(pasos(r)).toEqual(['base', 'minimo', 'tasa', 'sustraendo', 'topes', 'redondeo']);
    expect(r.foto.valores).toMatchObject({ valor_ut: 43, fila_id: 'f-001' });
  });

  it('por debajo del mínimo (UT × 83,3334 = 3.583,34) no retiene y lo dice', () => {
    const r = calcularLinea(ISLR_PNR, linea({ montos: { subtotal: 3000 }, fila: HONORARIOS_PNR }), CONTEXTO);
    expect(r).toMatchObject({ estado: 'calculado', monto: 0, cero: true, nota: 'No se retiene: la base no llega al mínimo.' });
  });

  it('una fila sin mínimo ni sustraendo da el % directo', () => {
    expect(monto(calcularLinea(ISLR_PNR, linea({ montos: { subtotal: 50000 }, fila: SERVICIOS_PJD }), CONTEXTO))).toBe(1000);
  });

  it('la base puede ser una porción, según la fila', () => {
    expect(monto(calcularLinea(ISLR_PNR, linea({ montos: { subtotal: 50000 }, fila: PORCION_PJD }), CONTEXTO))).toBe(900);
  });

  it('sin fila elegida no calcula: falta el concepto', () => {
    expect(calcularLinea(ISLR_PNR, linea({ montos: { subtotal: 50000 } }), CONTEXTO)).toMatchObject({ estado: 'sin_dato', falta: { tipo: 'fila' } });
  });

  it('sin UT, o con UT en 0, no calcula: nunca con 0 en silencio', () => {
    const sinUt: ContextoCalculo = { ...CONTEXTO, parametros: { ...CONTEXTO.parametros, valor_ut: null } };
    const utCero: ContextoCalculo = { ...CONTEXTO, parametros: { ...CONTEXTO.parametros, valor_ut: 0 } };
    for (const ctx of [sinUt, utCero]) {
      expect(calcularLinea(ISLR_PNR, linea({ montos: { subtotal: 50000 }, fila: HONORARIOS_PNR }), ctx))
        .toMatchObject({ estado: 'sin_dato', falta: { tipo: 'parametro', clave: 'valor_ut' } });
    }
  });

  it('sin UT pero con una fila sin mínimo ni sustraendo, sí calcula', () => {
    const sinUt: ContextoCalculo = { ...CONTEXTO, parametros: {} };
    expect(monto(calcularLinea(ISLR_PNR, linea({ montos: { subtotal: 50000 }, fila: SERVICIOS_PJD }), sinUt))).toBe(1000);
  });

  it('una fila sin % no calcula: falta el %', () => {
    expect(calcularLinea(ISLR_PNR, linea({ montos: { subtotal: 50000 }, fila: { ...SERVICIOS_PJD, pct: null } }), CONTEXTO))
      .toMatchObject({ estado: 'sin_dato', falta: { tipo: 'columna', columna: 'pct' } });
  });

  it('el sustraendo mayor que el bruto deja la retención en 0, nunca negativa', () => {
    // Justo encima del mínimo: 3.600 × 3 % = 108; sustraendo 107,50 → 0,50
    expect(monto(calcularLinea(ISLR_PNR, linea({ montos: { subtotal: 3600 }, fila: HONORARIOS_PNR }), CONTEXTO))).toBe(0.5);
    // Una fila con sustraendo y sin mínimo: 1.000 × 3 % = 30 − 107,50 → 0, nunca −77,50
    const r = calcularLinea(ISLR_PNR, linea({ montos: { subtotal: 1000 }, fila: { ...HONORARIOS_PNR, minimo: null } }), CONTEXTO);
    expect(monto(r)).toBe(0);
    expect(r.foto.pasos.find((p) => p.paso === 'topes')?.entradas.antes).toBe(-77.500086);
  });
});

describe('ISLR de persona jurídica no domiciliada, como dato: la Tarifa N° 2 por tramos', () => {
  it('el tramo sale de la base en UT; el sustraendo del tramo va en UT y el resultado vuelve a Bs', () => {
    // 100.000 Bs / 43 = 2.325,58 UT → tramo 2.000-3.000: 22 % − 140 UT → 371,63 UT × 43 = 15.980,00
    const r = calcularLinea(ISLR_PJND, linea({ montos: { subtotal: 100000 }, fila: SERVICIOS_PJND }), CONTEXTO);
    expect(monto(r)).toBe(15980);
    expect(r.foto.valores).toMatchObject({ base_ut: 2325.5814, tramo: { desde: 2000, hasta: 3000, pct: 22, sustraendo: 140 } });
  });

  it('una regla que toma el % de la tabla usa la tarifa de la fila cuando la fila trae tarifa y no %', () => {
    // La misma regla del ISLR sirve para las filas con % y para las de Tarifa N° 2
    const r = calcularLinea(ISLR_PNR, linea({ montos: { subtotal: 100000 }, fila: SERVICIOS_PJND }), CONTEXTO);
    expect(monto(r)).toBe(15980);
    expect(r.foto.pasos.find((p) => p.paso === 'tasa')?.operacion).toBe('tramos');
  });

  it('una fila sin % ni tarifa no calcula: falta el %', () => {
    expect(calcularLinea(ISLR_PNR, linea({ montos: { subtotal: 100000 }, fila: { ...SERVICIOS_PJND, tarifa_id: null } }), CONTEXTO))
      .toMatchObject({ estado: 'sin_dato', falta: { tipo: 'columna', columna: 'pct' } });
  });

  it('en el primer tramo, el % directo', () => {
    expect(monto(calcularLinea(ISLR_PJND, linea({ montos: { subtotal: 50000 }, fila: SERVICIOS_PJND }), CONTEXTO))).toBe(7500);
  });

  it('sin la tarifa vigente no calcula', () => {
    expect(calcularLinea(ISLR_PJND, linea({ montos: { subtotal: 50000 }, fila: SERVICIOS_PJND }), { ...CONTEXTO, tarifas: {} }))
      .toMatchObject({ estado: 'sin_dato', falta: { tipo: 'tarifa', tarifa_id: 't-2' } });
  });
});

describe('ISAE, como dato: subtotal − descuento, mínimo en la moneda de mayor valor, % de la actividad', () => {
  it('retiene el % de la actividad sobre la base sin IVA ni descuento', () => {
    const r = calcularLinea(ISAE, linea({ montos: { subtotal: 10000, descuento: 1000, iva: 1440 }, fila: ACTIVIDAD }), CONTEXTO);
    expect(monto(r)).toBe(225);
  });

  it('por debajo del mínimo (10 × la tasa de la MMV = 500 Bs) no retiene, y la foto guarda la tasa usada', () => {
    const r = calcularLinea(ISAE, linea({ montos: { subtotal: 400, descuento: 0 }, fila: ACTIVIDAD }), CONTEXTO);
    expect(r).toMatchObject({ estado: 'calculado', monto: 0 });
    expect(r.foto.valores.tasas.map((t) => t.moneda)).toEqual(['EUR']);
  });

  it('sin la tasa de la moneda de mayor valor no calcula', () => {
    expect(calcularLinea(ISAE, linea({ montos: { subtotal: 10000, descuento: 0 }, fila: ACTIVIDAD }), { ...CONTEXTO, tasaMmv: null }))
      .toMatchObject({ estado: 'sin_dato', falta: { tipo: 'tasa_mmv' } });
  });

  it('una factura en $ usa dos tasas, la del USD y la de la MMV, y las dos quedan en la foto', () => {
    const r = calcularLinea(ISAE, linea({ moneda: 'USD', montos: { subtotal: 100, descuento: 0 }, fila: ACTIVIDAD }), { ...CONTEXTO, tasa: TASA_USD });
    expect(monto(r)).toBe(100);
    expect(r.foto.valores.tasas.map((t) => t.moneda)).toEqual(['USD', 'EUR']);
  });
});

describe('IGTF, como dato: el % del parámetro sobre lo pagado en divisas', () => {
  it('retiene el 3 % de lo pagado en divisas, a la tasa de la fecha', () => {
    const r = calcularLinea(IGTF, linea({ tipo: 'pago', moneda: 'USD', montos: { pagado_divisas: 1000 } }), { ...CONTEXTO, tasa: TASA_USD });
    expect(monto(r)).toBe(1200);
  });

  it('un pago sin divisas da 0, con su nota', () => {
    expect(calcularLinea(IGTF, linea({ tipo: 'pago', montos: { pagado_divisas: 0 } }), CONTEXTO))
      .toMatchObject({ estado: 'calculado', monto: 0, cero: true, nota: 'El cálculo da 0,00 con estos datos.' });
  });

  it('sin el % vigente no calcula: falta el parámetro', () => {
    expect(calcularLinea(IGTF, linea({ tipo: 'pago', montos: { pagado_divisas: 100 } }), { ...CONTEXTO, parametros: {} }))
      .toMatchObject({ estado: 'sin_dato', falta: { tipo: 'parametro', clave: 'pct_igtf' } });
  });
});

describe('las piezas sueltas', () => {
  const vacia: VersionRegla = { ...IVA, id: 'v-vacia', pasos: {} };

  it('un paso ausente no hace nada: una regla sin pasos da 0', () => {
    const r = calcularLinea(vacia, linea({ montos: { iva: 100 } }), CONTEXTO);
    expect(monto(r)).toBe(0);
    expect(pasos(r)).toEqual(['redondeo']);
  });

  it('monto fijo y alícuota en la base', () => {
    const fijo: VersionRegla = { ...vacia, pasos: { base: { suma: ['subtotal'], resta: [], porcion: null, alicuota: null }, tasa: { op: 'monto_fijo', fuente: { tipo: 'fijo', valor: 25 } } } };
    expect(monto(calcularLinea(fijo, linea({ montos: { subtotal: 999 } }), CONTEXTO))).toBe(25);
    const causado: VersionRegla = { ...vacia, pasos: { base: { suma: ['subtotal'], resta: [], porcion: null, alicuota: { tipo: 'fijo', valor: 16 } }, retiene: { op: 'pct', fuente: { tipo: 'fijo', valor: 75 } } } };
    const r = calcularLinea(causado, linea({ montos: { subtotal: 1000 } }), CONTEXTO);
    expect(monto(r)).toBe(120);
    expect(r.foto.valores.alicuota).toBe(16);
  });

  it('el tope «máximo la base» corta un resultado que la supera', () => {
    const v: VersionRegla = { ...vacia, pasos: { base: { suma: ['subtotal'], resta: [], porcion: null, alicuota: null }, tasa: { op: 'monto_fijo', fuente: { tipo: 'fijo', valor: 500 } }, topes: { no_negativo: true, max_causado: false, max_base: true } } };
    expect(monto(calcularLinea(v, linea({ montos: { subtotal: 300 } }), CONTEXTO))).toBe(300);
  });

  it('una base negativa no se calcula: los montos del documento no cuadran', () => {
    const v: VersionRegla = { ...vacia, pasos: { base: { suma: ['subtotal'], resta: ['descuento'], porcion: null, alicuota: null }, tasa: { op: 'pct', fuente: { tipo: 'fijo', valor: 10 } } } };
    const r = calcularLinea(v, linea({ montos: { subtotal: 100, descuento: 200 } }), CONTEXTO);
    expect(r).toMatchObject({ estado: 'sin_dato', falta: { tipo: 'base_negativa' } });
    expect(r.estado === 'sin_dato' && r.nota).toBe('La base da negativa: 100,00 − 200,00 = -100,00. Revisar los montos del documento. No se calcula.');
  });

  it('un monto que la regla usa y no viene es un dato que falta, no un 0', () => {
    const r = calcularLinea(IVA, linea({ montos: { subtotal: 1000 } }), CONTEXTO);
    expect(r).toMatchObject({ estado: 'sin_dato', falta: { tipo: 'componente', componente: 'iva' } });
    expect(monto(calcularLinea(IVA, linea({ montos: { iva: 0 } }), CONTEXTO))).toBe(0);
  });

  it('la foto del paso 1 guarda los montos con los que se compuso la base', () => {
    const r = calcularLinea(ISAE, linea({ montos: { subtotal: 10000, descuento: 1000 }, fila: ACTIVIDAD }), CONTEXTO);
    expect(r.foto.pasos[0]).toMatchObject({ paso: 'base', entradas: { subtotal: 10000, '− descuento': 1000 }, valor: 9000 });
  });

  it('una regla sin paso de moneda con un documento en $ calcula, pero avisa', () => {
    const v: VersionRegla = { ...vacia, pasos: { base: { suma: ['subtotal'], resta: [], porcion: null, alicuota: null }, tasa: { op: 'pct', fuente: { tipo: 'fijo', valor: 10 } } } };
    const r = calcularLinea(v, linea({ moneda: 'USD', montos: { subtotal: 100 } }), CONTEXTO);
    expect(r).toMatchObject({ estado: 'calculado', monto: 10, avisos: ['El documento está en USD y la regla no convierte la moneda: el resultado queda en USD.'] });
  });

  it('el sustraendo «% × UT × factor» sin un paso de tasa en % es un error de la regla, no un 0', () => {
    const v: VersionRegla = { ...vacia, pasos: { base: { suma: ['subtotal'], resta: [], porcion: null, alicuota: null }, sustraendo: { op: 'ut_factor_pct', factor: { tipo: 'fijo', valor: 83.3334 } } } };
    expect(calcularLinea(v, linea({ montos: { subtotal: 100 } }), CONTEXTO)).toMatchObject({ estado: 'sin_dato', falta: { tipo: 'regla' } });
  });

  it('redondea la mitad hacia arriba, sin el error de coma flotante', () => {
    expect(redondear(1.005)).toBe(1.01);
    expect(redondear(2.675)).toBe(2.68);
    expect(redondear(1392.49957)).toBe(1392.5);
    expect(redondear(-1.005)).toBe(-1.01);
  });

  it('la foto lleva la versión de la regla y un paso por cada paso que actuó', () => {
    const r = calcularLinea(ISLR_PNR, linea({ montos: { subtotal: 50000 }, fila: HONORARIOS_PNR }), CONTEXTO);
    expect(r.foto.regla_version_id).toBe('v-islr-pnr');
    const sus = r.foto.pasos.find((p) => p.paso === 'sustraendo');
    expect(sus).toMatchObject({ operacion: 'ut_factor_pct', entradas: { pct: 3, ut: 43, factor: 83.3334, sustraendo: 107.500086 } });
  });

  it('una línea de bienes no lleva una regla de servicios', () => {
    const servicios: VersionRegla = { ...ISLR_PNR, operacion: 'servicios' };
    const r = calcularLinea(servicios, linea({ operacion: 'bienes', montos: { subtotal: 50000 }, fila: HONORARIOS_PNR }), CONTEXTO);
    expect(r).toMatchObject({ estado: 'no_aplica', motivo: 'La línea es de bienes; la regla aplica solo a servicios.' });
  });
});

describe('los bordes', () => {
  const vacia: VersionRegla = { ...IVA, id: 'v-vacia', pasos: {} };
  const base = { suma: ['subtotal' as const], resta: [], porcion: null, alicuota: null };

  it('la base exactamente igual al mínimo sí retiene (ISAE: 10 × 50 = 500)', () => {
    expect(monto(calcularLinea(ISAE, linea({ montos: { subtotal: 500, descuento: 0 }, fila: ACTIVIDAD }), CONTEXTO))).toBe(12.5);
    expect(monto(calcularLinea(ISAE, linea({ montos: { subtotal: 499.99, descuento: 0 }, fila: ACTIVIDAD }), CONTEXTO))).toBe(0);
  });

  it('el mínimo en Bs', () => {
    const v: VersionRegla = { ...vacia, pasos: { base, minimo: { fuente: { tipo: 'fijo', valor: 1000 }, unidad: 'bs' }, tasa: { op: 'pct', fuente: { tipo: 'fijo', valor: 10 } } } };
    expect(monto(calcularLinea(v, linea({ montos: { subtotal: 999.99 } }), CONTEXTO))).toBe(0);
    expect(monto(calcularLinea(v, linea({ montos: { subtotal: 1000 } }), CONTEXTO))).toBe(100);
  });

  it('el tramo en el límite exacto (2.000 UT) y la base 0 en los tramos', () => {
    // 2.000 UT × 43 = 86.000 Bs: 15 % de 2.000 = 300 UT, lo mismo que 22 % − 140; × 43 = 12.900
    expect(monto(calcularLinea(ISLR_PJND, linea({ montos: { subtotal: 86000 }, fila: SERVICIOS_PJND }), CONTEXTO))).toBe(12900);
    const r = calcularLinea(ISLR_PJND, linea({ montos: { subtotal: 0 }, fila: SERVICIOS_PJND }), CONTEXTO);
    expect(r).toMatchObject({ estado: 'calculado', monto: 0 });
  });

  it('el tope «máximo el causado» corta de verdad', () => {
    const v: VersionRegla = { ...vacia, pasos: { base: { ...base, suma: ['iva'] }, retiene: { op: 'pct', fuente: { tipo: 'fijo', valor: 150 } }, topes: { no_negativo: true, max_causado: true, max_base: false } } };
    expect(monto(calcularLinea(v, linea({ montos: { iva: 100 } }), CONTEXTO))).toBe(100);
  });

  it('el sustraendo como monto', () => {
    const v: VersionRegla = { ...vacia, pasos: { base, tasa: { op: 'pct', fuente: { tipo: 'fijo', valor: 10 } }, sustraendo: { op: 'monto', fuente: { tipo: 'fijo', valor: 5 } } } };
    expect(monto(calcularLinea(v, linea({ montos: { subtotal: 100 } }), CONTEXTO))).toBe(5);
  });

  it('una tasa de otra moneda no sirve: la del EUR no convierte un documento en USD', () => {
    const eur = { moneda: 'EUR', tasa: 50, fecha: '2026-10-14', fuente: 'bcv' };
    expect(calcularLinea(IVA, linea({ moneda: 'USD', montos: { iva: 100 } }), { ...CONTEXTO, tasa: eur }))
      .toMatchObject({ estado: 'sin_dato', falta: { tipo: 'tasa', moneda: 'USD' } });
    expect(monto(calcularLinea(IVA, linea({ moneda: 'EUR', montos: { iva: 100 } }), { ...CONTEXTO, tasa: eur }))).toBe(3750);
  });

  it('0,1 + 0,2 da 0,3, y la foto no guarda el ruido de coma flotante', () => {
    const v: VersionRegla = { ...vacia, pasos: { base: { ...base, suma: ['subtotal', 'otros_cargos'] }, tasa: { op: 'pct', fuente: { tipo: 'fijo', valor: 100 } } } };
    const r = calcularLinea(v, linea({ montos: { subtotal: 0.1, otros_cargos: 0.2 } }), CONTEXTO);
    expect(monto(r)).toBe(0.3);
    expect(r.foto.pasos[0].valor).toBe(0.3);
  });

  it('una nota de crédito por debajo del mínimo da 0, nunca −0; por encima, resta', () => {
    const debajo = calcularLinea(ISAE, linea({ tipo: 'nc', montos: { subtotal: 400, descuento: 0 }, fila: ACTIVIDAD }), CONTEXTO);
    expect(Object.is(monto(debajo), 0)).toBe(true);
    expect(monto(calcularLinea(ISAE, linea({ tipo: 'nc', montos: { subtotal: 1000, descuento: 0 }, fila: ACTIVIDAD }), CONTEXTO))).toBe(-25);
    expect(Object.is(redondear(-0.001), 0)).toBe(true);
  });

  it('el redondeo intermedio: exacto por defecto; «publicado» usa 107,50 y 3.583,34, y puede mover un céntimo', () => {
    // 20.000,05 × 5 % = 1.000,0025; sustraendo exacto 179,16681 → 820,84; publicado 179,17 → 820,83
    const e = linea({ montos: { subtotal: 20000.05 }, fila: COMISIONES_PNR });
    expect(monto(calcularLinea(ISLR_PNR, e, CONTEXTO))).toBe(820.84);
    expect(monto(calcularLinea(ISLR_PNR, e, { ...CONTEXTO, redondeoIntermedio: 'publicado' }))).toBe(820.83);
  });
});
