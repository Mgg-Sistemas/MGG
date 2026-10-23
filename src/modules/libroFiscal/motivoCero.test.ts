import { describe, expect, it } from 'vitest';
import { validarMotivoCero, esCeroSinMotivo } from './motivoCero';

describe('validarMotivoCero', () => {
  it('no requiere motivo si el porcentaje y monto son positivos', () => {
    const r = validarMotivoCero(75, 150, null, 'iva');
    expect(r.requiereMotivo).toBe(false);
    expect(r.mensaje).toBeNull();
  });

  it('requiere motivo cuando porcentaje es 0 y no hay motivo', () => {
    const r = validarMotivoCero(0, 0, null, 'iva');
    expect(r.requiereMotivo).toBe(true);
    expect(r.mensaje).toContain('0 %');
  });

  it('requiere motivo cuando monto es 0 y no hay motivo', () => {
    const r = validarMotivoCero(75, 0, '', 'islr');
    expect(r.requiereMotivo).toBe(true);
    expect(r.mensaje).toContain('ISLR');
  });

  it('acepta si el motivo está presente', () => {
    const r = validarMotivoCero(0, 0, 'Exento por convenio', 'municipal');
    expect(r.requiereMotivo).toBe(true);
    expect(r.mensaje).toBeNull();
  });

  it('rechaza motivo con solo espacios', () => {
    const r = validarMotivoCero(0, 0, '   ', 'iva');
    expect(r.requiereMotivo).toBe(true);
    expect(r.mensaje).not.toBeNull();
  });
});

describe('esCeroSinMotivo', () => {
  it('true cuando porcentaje 0 y sin motivo', () => {
    expect(esCeroSinMotivo(0, 0, null)).toBe(true);
  });

  it('false cuando hay motivo', () => {
    expect(esCeroSinMotivo(0, 0, 'Motivo')).toBe(false);
  });

  it('false cuando monto > 0', () => {
    expect(esCeroSinMotivo(75, 100, null)).toBe(false);
  });
});
