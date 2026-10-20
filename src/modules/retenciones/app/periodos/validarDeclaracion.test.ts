import { describe, expect, it } from 'vitest';
import { leerMonto, validarDeclaracion, validarPasoInicial } from './validarDeclaracion';

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
