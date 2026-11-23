import { describe, it, expect } from 'vitest';
import { diaSiguienteVE, hoyVE, round2, round4, aBs, aExtranjero, aReal, aDolaresDesdeReal } from './tasas.repository';

describe('Tasas en Feriado Bancario y Correcciones Manuales', () => {
  it('calcula el día siguiente en horario de Venezuela correctamente', () => {
    expect(diaSiguienteVE('2026-11-23')).toBe('2026-11-24');
    expect(diaSiguienteVE('2026-11-30')).toBe('2026-12-01');
    expect(diaSiguienteVE('2026-12-31')).toBe('2027-01-01');
  });

  it('hoyVE devuelve fecha con formato YYYY-MM-DD', () => {
    const hoy = hoyVE();
    expect(hoy).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('conversión a Bs y extranjero con tasa', () => {
    expect(aBs(100, 920.5)).toBe(92050);
    expect(aExtranjero(92050, 920.5)).toBe(100);
    expect(aExtranjero(100, 0)).toBe(0);
  });

  it('conversión con Real brasileño y redondeos', () => {
    expect(aReal(20, 5.0428)).toBe(100.86);
    expect(aDolaresDesdeReal(100.86, 5.0428)).toBe(20);
    expect(round4(5.123456)).toBe(5.1235);
    expect(round2(100.126)).toBe(100.13);
  });
});
