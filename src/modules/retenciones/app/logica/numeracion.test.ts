import { describe, expect, it } from 'vitest';
import {
  FORMATO_IVA, FORMATO_DIEZ, accionCorreccion, armarNumero, avisosNumero, numeroValido, planRecalculo, secuencial, siguienteNumero,
} from './numeracion';

describe('la serie: secuencial, armado y siguiente', () => {
  it('el IVA lleva AAAAMM + 8 dígitos; el secuencial son los 8 últimos', () => {
    expect(secuencial('20261000000012', FORMATO_IVA)).toBe(12);
    expect(armarNumero(13, FORMATO_IVA, '202610')).toBe('20261000000013');
  });

  it('ISLR e ISAE llevan 10 dígitos', () => {
    expect(secuencial('0000000039', FORMATO_DIEZ)).toBe(39);
    expect(armarNumero(40, FORMATO_DIEZ, '202610')).toBe('0000000040');
  });

  it('la serie es continua: el siguiente sigue al último aunque cambie el mes', () => {
    expect(siguienteNumero('20260900000537', FORMATO_IVA, '202610', new Set())).toBe('20261000000538');
    expect(siguienteNumero('0000000039', FORMATO_DIEZ, '202610', new Set())).toBe('0000000040');
  });

  it('sin números todavía, empieza en 1', () => {
    expect(siguienteNumero(null, FORMATO_IVA, '202610', new Set())).toBe('20261000000001');
  });

  it('salta los números retirados: no se vuelven a usar', () => {
    const retirados = new Set(['0000000040', '0000000041']);
    expect(siguienteNumero('0000000039', FORMATO_DIEZ, '202610', retirados)).toBe('0000000042');
  });

  it('valida el formato de la serie', () => {
    expect(numeroValido('20261000000012', FORMATO_IVA)).toBe(true);
    expect(numeroValido('20261300000012', FORMATO_IVA)).toBe(false);
    expect(numeroValido('2026100000001', FORMATO_IVA)).toBe(false);
    expect(numeroValido('0000000039', FORMATO_DIEZ)).toBe(true);
    expect(numeroValido('000000039', FORMATO_DIEZ)).toBe(false);
  });
});

describe('los avisos del número editado (D21b)', () => {
  const prop = '20261000000538';

  it('el número propuesto, o vacío, no avisa', () => {
    expect(avisosNumero(prop, prop, FORMATO_IVA, '202610', 'no')).toEqual([]);
    expect(avisosNumero('', prop, FORMATO_IVA, '202610', 'no')).toEqual([]);
  });

  it('un formato que no es el de la serie es un aviso fuerte', () => {
    expect(avisosNumero('12345', prop, FORMATO_IVA, '202610', 'no')).toEqual([{ nivel: 'fuerte', texto: 'Formato de la serie: AAAAMM + 8 dígitos.' }]);
  });

  it('un número que no es el siguiente avisa, y dice si es menor', () => {
    expect(avisosNumero('20261000000540', prop, FORMATO_IVA, '202610', 'no')).toEqual([{ nivel: 'medio', texto: 'El número no es el siguiente de la serie (20261000000538).' }]);
    expect(avisosNumero('20261000000530', prop, FORMATO_IVA, '202610', 'no')[0].texto).toBe('El número no es el siguiente de la serie (20261000000538): es menor.');
  });

  it('un salto de más de 50 posiciones pide verificar', () => {
    expect(avisosNumero('20261000000600', prop, FORMATO_IVA, '202610', 'no')[0].texto)
      .toBe('El número no es el siguiente de la serie (20261000000538): salto de 62 posiciones respecto del último número. Verificar.');
  });

  it('en el IVA, un prefijo distinto del período de la factura solo avisa', () => {
    const av = avisosNumero('20260900000538', prop, FORMATO_IVA, '202610', 'no');
    expect(av).toContainEqual({ nivel: 'medio', texto: 'El prefijo 202609 no coincide con el período de la factura (202610).' });
  });

  it('un número ya usado o retirado es un aviso fuerte', () => {
    expect(avisosNumero('20261000000530', prop, FORMATO_IVA, '202610', 'usado')).toContainEqual({ nivel: 'fuerte', texto: 'Número de comprobante ya registrado.' });
    expect(avisosNumero('20261000000530', prop, FORMATO_IVA, '202610', 'retirado')).toContainEqual({ nivel: 'fuerte', texto: 'Número retirado: no se vuelve a usar.' });
  });
});

describe('«la última de su serie»: qué se hace al corregir', () => {
  it('declarada: no se corrige (primero se reabre el período)', () => {
    expect(accionCorreccion({ numero: '0000000040', impresa: true, declarada: true }, '0000000040', '0000000041')).toEqual({ tipo: 'bloqueada' });
  });

  it('sin imprimir: se corrige en sitio, con el mismo número', () => {
    expect(accionCorreccion({ numero: '0000000030', impresa: false, declarada: false }, '0000000040', '0000000041')).toEqual({ tipo: 'sitio' });
  });

  it('impresa y la última de su serie: el mismo número, y se reimprime', () => {
    expect(accionCorreccion({ numero: '0000000040', impresa: true, declarada: false }, '0000000040', '0000000041')).toEqual({ tipo: 'sitio_ultima' });
  });

  it('impresa y no la última: se anula y se rehace con el siguiente', () => {
    expect(accionCorreccion({ numero: '0000000030', impresa: true, declarada: false }, '0000000040', '0000000041')).toEqual({ tipo: 'rehacer', numero: '0000000041' });
  });
});

describe('el plan del recálculo', () => {
  const fila = (id: string, numero: string, over: Partial<{ impresa: boolean; declarada: boolean; antes: number; despues: number }> = {}) =>
    ({ id, tipo: 'islr', numero, periodo: '202610', impresa: true, declarada: false, antes: 100, despues: 120, ...over });

  it('con una declarada afectada, el cambio se bloquea y se listan las declaradas', () => {
    const p = planRecalculo([fila('a', '0000000030', { declarada: true }), fila('b', '0000000031')], { islr: '0000000040' }, () => 'x');
    expect(p.bloqueado).toBe(true);
    expect(p.bloqueadas.map((x) => x.id)).toEqual(['a']);
  });

  it('las que no cambian de monto no entran', () => {
    const p = planRecalculo([fila('a', '0000000030', { despues: 100 })], { islr: '0000000040' }, () => 'x');
    expect(p.filas).toEqual([]);
  });

  it('«la última» se evalúa una vez, antes de procesar, y no repite números nuevos', () => {
    let n = 41;
    const siguiente = (_tipo: string, _periodo: string, yaDados: ReadonlySet<string>) => {
      let s = String(n).padStart(10, '0');
      while (yaDados.has(s)) s = String(++n).padStart(10, '0');
      return s;
    };
    const p = planRecalculo([fila('a', '0000000030'), fila('b', '0000000031'), fila('c', '0000000040'), fila('d', '0000000035', { impresa: false })], { islr: '0000000040' }, siguiente);
    expect(p.bloqueado).toBe(false);
    expect(p.filas.map((x) => [x.id, x.accion])).toEqual([
      ['a', { tipo: 'rehacer', numero: '0000000041' }],
      ['b', { tipo: 'rehacer', numero: '0000000042' }],
      ['c', { tipo: 'sitio_ultima' }],
      ['d', { tipo: 'sitio' }],
    ]);
  });
});
