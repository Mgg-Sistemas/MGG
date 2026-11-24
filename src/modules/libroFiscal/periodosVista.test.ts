import { describe, expect, it } from 'vitest';
import { periodosAplicables } from './periodosVista';
import type { ImpuestosActivos } from '@/modules/retenciones/impuestosVista';

const periodos = [
  { tipo: 'IVA', periodo: '202611' },
  { tipo: 'ISLR', periodo: '202611' },
  { tipo: 'MUNICIPAL', periodo: '202611' },
  { tipo: 'IGTF', periodo: '202611' },
];

const activosSolo = {
  claves: new Set(['iva', 'islr', 'municipal', 'igtf'] as const),
  orden: new Map<string, number>(),
} as unknown as ImpuestosActivos;

describe('periodosAplicables', () => {
  it('oculta los impuestos desactivados en Parámetros', () => {
    const sinIgtf = {
      claves: new Set(['iva', 'islr', 'municipal'] as const),
      orden: new Map<string, number>(),
    } as unknown as ImpuestosActivos;
    expect(periodosAplicables(periodos, sinIgtf, null, 2026, 2026).map((p) => p.tipo))
      .toEqual(['IVA', 'ISLR', 'MUNICIPAL']);
  });

  it('el régimen oculta en el año en curso, pero conserva años anteriores para auditoría', () => {
    const practica = new Set(['IVA', 'ISLR', 'IGTF']);
    expect(periodosAplicables(periodos, activosSolo, practica, 2026, 2026).map((p) => p.tipo))
      .toEqual(['IVA', 'ISLR', 'IGTF']);
    expect(periodosAplicables(periodos, activosSolo, practica, 2025, 2026)).toHaveLength(4);
  });

  it('si falló alguna lectura, deja ver todo en vez de vaciar la pantalla', () => {
    expect(periodosAplicables(periodos, null, null, 2026, 2026)).toHaveLength(4);
  });
});
