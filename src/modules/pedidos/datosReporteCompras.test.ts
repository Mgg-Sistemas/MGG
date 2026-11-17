import { describe, expect, test } from 'vitest';
import { filtrarPorRango } from './datosReporteCompras';

describe('datosReporteCompras · filtrarPorRango', () => {
  const rows = [
    { at: '2026-11-01T08:00:00Z' },
    { at: '2026-11-10T23:00:00Z' },
    { at: '2026-10-31T23:00:00Z' },
    { at: '2026-11-11T00:00:00Z' },
    { at: null },
  ];

  test('incluye los extremos del rango y descarta lo de fuera o sin fecha', () => {
    const dentro = filtrarPorRango(rows, (r) => r.at, '2026-11-01', '2026-11-10');
    expect(dentro.map((r) => r.at)).toEqual(['2026-11-01T08:00:00Z', '2026-11-10T23:00:00Z']);
  });
});
