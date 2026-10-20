import { describe, expect, it } from 'vitest';
import { diaDeTasa } from './tasas';

// Los mismos casos que retencion_dia_tasa (D42 v2) en la base: tienen que dar lo mismo.
describe('el día cuya tasa vale', () => {
  it('de lunes a viernes, el mismo día', () => {
    expect(diaDeTasa('2026-10-12')).toBe('2026-10-12');
    expect(diaDeTasa('2026-10-16')).toBe('2026-10-16');
  });

  it('sábado y domingo pasan al lunes siguiente (por defecto)', () => {
    expect(diaDeTasa('2026-10-17')).toBe('2026-10-19');
    expect(diaDeTasa('2026-10-18')).toBe('2026-10-19');
  });

  it('con el interruptor en «viernes», pasan al viernes anterior', () => {
    expect(diaDeTasa('2026-10-17', 'viernes')).toBe('2026-10-16');
    expect(diaDeTasa('2026-10-18', 'viernes')).toBe('2026-10-16');
  });

  it('cruza el mes y el año sin problema', () => {
    expect(diaDeTasa('2026-10-31')).toBe('2026-11-02');
    expect(diaDeTasa('2027-01-02', 'viernes')).toBe('2027-01-01');
  });
});
