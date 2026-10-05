import { describe, expect, it } from 'vitest';
import { carnetVencido, finDeMes, textoVence, venceTras } from './carnetVence';

describe('vencimiento del carnet', () => {
  it('por mes y año vale hasta el último día del mes', () => {
    expect(finDeMes(12, 2026)).toBe('2026-12-31');
    expect(finDeMes(2, 2028)).toBe('2028-02-29');
    expect(finDeMes(13, 2026)).toBeNull();
  });
  it('por días y semanas', () => {
    expect(venceTras('2026-10-05', 30, 'dias')).toBe('2026-11-04');
    expect(venceTras('2026-12-28', 1, 'semanas')).toBe('2027-01-04');
  });
  it('por meses y años, sin pasarse del fin de mes', () => {
    expect(venceTras('2026-01-31', 1, 'meses')).toBe('2026-02-28');
    expect(venceTras('2026-10-05', 3, 'meses')).toBe('2027-01-05');
    expect(venceTras('2028-02-29', 1, 'anios')).toBe('2029-02-28');
  });
  it('cantidades inválidas no dan fecha', () => {
    expect(venceTras('2026-10-05', 0, 'dias')).toBeNull();
    expect(venceTras('05/10/2026', 3, 'dias')).toBeNull();
  });
  it('texto y vencido', () => {
    expect(textoVence('2026-12-31')).toBe('31/12/2026');
    expect(carnetVencido('2026-12-31', '2026-12-31')).toBe(false);
    expect(carnetVencido('2026-12-31', '2027-01-01')).toBe(true);
    expect(carnetVencido(null)).toBe(false);
  });
});
