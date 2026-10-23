import { describe, it, expect } from 'vitest';
import { rangoActivo, rangoRapido } from './rangosFecha';

describe('rangoRapido', () => {
  it('este mes, mes pasado, 90 días y año', () => {
    expect(rangoRapido('mes', '2026-09-28')).toEqual({ desde: '2026-09-01', hasta: '2026-09-28' });
    expect(rangoRapido('mesPasado', '2026-09-28')).toEqual({ desde: '2026-08-01', hasta: '2026-08-31' });
    expect(rangoRapido('mesPasado', '2026-01-15')).toEqual({ desde: '2025-12-01', hasta: '2025-12-31' });
    expect(rangoRapido('ult90', '2026-09-28')).toEqual({ desde: '2026-07-01', hasta: '2026-09-28' });
    expect(rangoRapido('anio', '2026-09-28')).toEqual({ desde: '2026-01-01', hasta: '2026-09-28' });
  });
  it('reconoce el atajo activo', () => {
    expect(rangoActivo('2026-09-01', '2026-09-28', '2026-09-28')).toBe('mes');
    expect(rangoActivo('2026-09-02', '2026-09-28', '2026-09-28')).toBeNull();
  });
});
