import { describe, expect, it } from 'vitest';
import { rangoDeAtajo } from './Reportes';

describe('los atajos del período de Reportes (maqueta: ATAJOS, «últimos N» cuenta el mes en curso)', () => {
  const hoy = new Date(2026, 9, 20); // 20/10/2026
  it('este mes, mes anterior, últimos 6 y 12 meses', () => {
    expect(rangoDeAtajo('mes', hoy, '', '')).toEqual(['2026-10-01', '2026-10-20']);
    expect(rangoDeAtajo('mes_anterior', hoy, '', '')).toEqual(['2026-09-01', '2026-09-30']);
    expect(rangoDeAtajo('ultimos_6', hoy, '', '')).toEqual(['2026-05-01', '2026-10-20']);
    expect(rangoDeAtajo('ultimos_12', hoy, '', '')).toEqual(['2025-11-01', '2026-10-20']);
  });
  it('desde · hasta: lo escrito', () => {
    expect(rangoDeAtajo('rango', hoy, '2026-01-01', '2026-03-31')).toEqual(['2026-01-01', '2026-03-31']);
  });
});
