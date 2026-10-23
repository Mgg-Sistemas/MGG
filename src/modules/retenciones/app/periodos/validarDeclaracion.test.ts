import { describe, expect, it } from 'vitest';
import { leerMonto, periodoCerradoPara, validarDeclaracion, validarPasoInicial } from './validarDeclaracion';
import type { PeriodoRetencion } from '../datos/periodos';

const ok = { fecha: '2026-10-18', planilla: '99035', numero: '', monto: '1.234,56', observacion: '' };

describe('marcar un período como declarado', () => {
  it('lee montos con coma decimal o con punto', () => {
    expect(leerMonto('1.234,56')).toBe(1234.56);
    expect(leerMonto('1234.56')).toBe(1234.56);
    expect(leerMonto('0')).toBe(0);
    expect(leerMonto('abc')).toBeNull();
    expect(leerMonto('')).toBeNull();
  });

  it('acepta una declaración completa, con 0 si no hubo operaciones', () => {
    expect(validarDeclaracion(ok, '2026-10-15', '2026-10-20').declaracion).toMatchObject({ monto: 1234.56, planilla: '99035' });
    expect(validarDeclaracion({ ...ok, monto: '0' }, '2026-10-15', '2026-10-20').declaracion?.monto).toBe(0);
  });

  it('la fecha va después del cierre y no es futura; el monto es obligatorio y no negativo', () => {
    expect(validarDeclaracion({ ...ok, fecha: '2026-10-15' }, '2026-10-15', '2026-10-20').errores.fecha).toMatch(/después/);
    expect(validarDeclaracion({ ...ok, fecha: '2026-10-21' }, '2026-10-15', '2026-10-20').errores.fecha).toMatch(/futura/);
    expect(validarDeclaracion({ ...ok, fecha: '' }, '2026-10-15', '2026-10-20').errores.fecha).toMatch(/requerida/);
    expect(validarDeclaracion({ ...ok, monto: '' }, '2026-10-15', '2026-10-20').errores.monto).toMatch(/requerido/);
    expect(validarDeclaracion({ ...ok, monto: '-5' }, '2026-10-15', '2026-10-20').errores.monto).toMatch(/negativo/);
    expect(validarDeclaracion({ ...ok, planilla: 'x'.repeat(21) }, '2026-10-15', '2026-10-20').declaracion).toBeNull();
  });
});

describe('el paso inicial', () => {
  const base = { inicio: '2026-10-16', nombre: 'Octubre 2026, 2.ª quincena', ultimo: '20261000000041', anteriores: true };
  it('acepta un inicio válido y pasa el último N° del otro sistema', () => {
    expect(validarPasoInicial(base, '2026-10-20').paso).toMatchObject({ inicio: '2026-10-16', ultimoNumero: 20261000000041, anterioresOtroSistema: true });
    expect(validarPasoInicial({ ...base, ultimo: '' }, '2026-10-20').paso?.ultimoNumero).toBeNull();
  });
  it('rechaza un inicio vacío, futuro o anterior a 2020, y un número con letras', () => {
    expect(validarPasoInicial({ ...base, inicio: '' }, '2026-10-20').errores.inicio).toMatch(/requerido/);
    expect(validarPasoInicial({ ...base, inicio: '2026-10-21' }, '2026-10-20').errores.inicio).toMatch(/después de hoy/);
    expect(validarPasoInicial({ ...base, inicio: '2019-12-31' }, '2026-10-20').errores.inicio).toMatch(/2020/);
    expect(validarPasoInicial({ ...base, ultimo: 'A-12' }, '2026-10-20').errores.ultimo).toMatch(/dígitos/);
  });
});

describe('periodoCerradoPara: guarda de períodos cerrados/declarados', () => {
  const lista: PeriodoRetencion[] = [
    {
      id: 'p1', tipo: 'iva', periodo: '202610', tramo: 1, desde: '2026-10-01', hasta: '2026-10-15',
      vence: '2026-10-20', estado: 'declarado', retencionesVigentes: 5, declaradoEn: '2026-10-18T10:00:00Z',
      declaradoPor: 'admin', montoEnterado: 500, planilla: '9901', numeroDeclaracion: '1', observacion: null,
      reabiertoEn: null, reabiertoPor: null, reabiertoMotivo: null, diasParaVencer: null, declara: 'mgg',
      declaradoRegistradoEn: null, retenidoBs: 0, retenidoUsd: 0,
    },
    {
      id: 'p2', tipo: 'iva', periodo: '202610', tramo: 2, desde: '2026-10-16', hasta: '2026-10-31',
      vence: '2026-11-05', estado: 'abierto', retencionesVigentes: 2, declaradoEn: null, declaradoPor: null,
      montoEnterado: null, planilla: null, numeroDeclaracion: null, observacion: null, reabiertoEn: null,
      reabiertoPor: null, reabiertoMotivo: null, diasParaVencer: null, declara: 'mgg',
      declaradoRegistradoEn: null, retenidoBs: 0, retenidoUsd: 0,
    },
    {
      id: 'p3', tipo: 'islr', periodo: '202610', tramo: 0, desde: '2026-10-01', hasta: '2026-10-31',
      vence: '2026-11-10', estado: 'abierto', retencionesVigentes: 1, declaradoEn: null, declaradoPor: null,
      montoEnterado: null, planilla: null, numeroDeclaracion: null, observacion: null, reabiertoEn: null,
      reabiertoPor: null, reabiertoMotivo: null, diasParaVencer: null, declara: 'mgg',
      declaradoRegistradoEn: null, retenidoBs: 0, retenidoUsd: 0,
    },
  ];

  it('detecta si una fecha cae en un período declarado para el tipo de impuesto', () => {
    const cerrado = periodoCerradoPara('iva', '2026-10-10', lista);
    expect(cerrado).not.toBeNull();
    expect(cerrado?.id).toBe('p1');
  });

  it('devuelve null si el período está abierto o es de otro tipo de impuesto', () => {
    expect(periodoCerradoPara('iva', '2026-10-20', lista)).toBeNull();
    expect(periodoCerradoPara('islr', '2026-10-10', lista)).toBeNull();
  });

  it('devuelve null si la fecha no es válida o la lista está vacía', () => {
    expect(periodoCerradoPara('iva', '', lista)).toBeNull();
    expect(periodoCerradoPara('iva', 'no-fecha', lista)).toBeNull();
    expect(periodoCerradoPara('iva', '2026-10-10', [])).toBeNull();
    expect(periodoCerradoPara('iva', '2026-10-10', null)).toBeNull();
  });
});

