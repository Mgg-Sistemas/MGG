import { describe, it, expect } from 'vitest';
import type { Orden } from '@/shared/lib/types';
import {
  estadoRetencion, estadoRetencionDeOrden, estadoRetencionDeBuzon, estadoRetencionSoloOrden, impuestosHechosDeOrden,
  badgeEstadoRetencion, textoPago,
} from './estadoRetencion';

const ordenBase = {
  retencion_iva_path: null, retencion_islr_path: null, retencion_municipal_path: null,
  retencion_finalizada: false, retencion_pagada: false,
} as Pick<Orden, 'retencion_iva_path' | 'retencion_islr_path' | 'retencion_municipal_path' | 'retencion_finalizada' | 'retencion_pagada'>;

describe('estadoRetencion (núcleo)', () => {
  it('sin aplicables → no_aplica', () => {
    expect(estadoRetencion([], []).estado).toBe('no_aplica');
  });
  it('todo lo aplicable hecho → retenida', () => {
    const r = estadoRetencion(['iva', 'islr'], ['iva', 'islr']);
    expect(r.estado).toBe('retenida');
    expect(r.faltantes).toEqual([]);
  });
  it('nada hecho → no_retenida', () => {
    const r = estadoRetencion(['iva', 'islr'], []);
    expect(r.estado).toBe('no_retenida');
    expect(r.faltantes).toEqual(['iva', 'islr']);
  });
  it('algo hecho y algo falta → parcial', () => {
    const r = estadoRetencion(['iva', 'islr'], ['iva']);
    expect(r.estado).toBe('parcial');
    expect(r.hechas).toEqual(['iva']);
    expect(r.faltantes).toEqual(['islr']);
  });
  it('un hecho que no es aplicable no cuenta como aplicable', () => {
    const r = estadoRetencion(['iva'], ['iva', 'municipal']);
    expect(r.estado).toBe('retenida');
    expect(r.aplicables).toEqual(['iva']);
  });
});

describe('estadoRetencionDeOrden', () => {
  it('con faltantes y nada hecho → no_retenida', () => {
    const r = estadoRetencionDeOrden(ordenBase, ['iva', 'islr']);
    expect(r.estado).toBe('no_retenida');
  });
  it('un path hecho y otro faltante → parcial', () => {
    const r = estadoRetencionDeOrden({ ...ordenBase, retencion_iva_path: 'x.pdf' }, ['islr']);
    expect(r.estado).toBe('parcial');
    expect(r.hechas).toEqual(['iva']);
  });
  it('registradas del libro cuentan como hechas', () => {
    const r = estadoRetencionDeOrden(ordenBase, ['islr'], new Set(['iva']));
    expect(r.estado).toBe('parcial');
    expect(r.hechas).toContain('iva');
  });
  it('retencion_finalizada manda: retenida aunque haya faltantes', () => {
    const r = estadoRetencionDeOrden({ ...ordenBase, retencion_finalizada: true, retencion_iva_path: 'x' }, ['islr']);
    expect(r.estado).toBe('retenida');
    expect(r.faltantes).toEqual([]);
  });
  it('estado de pago con monto solo si está pagada y se pasa el pago', () => {
    const r = estadoRetencionDeOrden({ ...ordenBase, retencion_pagada: true }, [], new Set(['iva']), { monto: 1500, moneda: 'Bs' });
    expect(r.pagada).toBe(true);
    expect(textoPago(r)).toBe('✓ Pagada: Bs 1.500,00');
  });
  it('pagada sin monto → solo «✓ Pagada»', () => {
    const r = estadoRetencionDeOrden({ ...ordenBase, retencion_pagada: true }, [], new Set(['iva']));
    expect(textoPago(r)).toBe('✓ Pagada');
  });
});

describe('impuestosHechosDeOrden', () => {
  it('une paths de la OC y registradas del libro, solo iva/islr/municipal', () => {
    const h = impuestosHechosDeOrden({ ...ordenBase, retencion_islr_path: 'y' }, new Set(['iva']));
    expect(h.sort()).toEqual(['islr', 'iva']);
  });
});

describe('estadoRetencionSoloOrden (grueso, para Compras)', () => {
  it('finalizada → retenida', () => {
    expect(estadoRetencionSoloOrden({ ...ordenBase, retencion_finalizada: true }).estado).toBe('retenida');
  });
  it('con algún path pero sin finalizar → parcial', () => {
    expect(estadoRetencionSoloOrden({ ...ordenBase, retencion_islr_path: 'y' }).estado).toBe('parcial');
  });
  it('sin paths ni finalizar → no_retenida', () => {
    expect(estadoRetencionSoloOrden(ordenBase).estado).toBe('no_retenida');
  });
  it('lleva el estado de pago', () => {
    expect(estadoRetencionSoloOrden({ ...ordenBase, retencion_pagada: true }).pagada).toBe(true);
  });
});

describe('estadoRetencionDeBuzon', () => {
  it('estatus retenida → retenida', () => expect(estadoRetencionDeBuzon('retenida').estado).toBe('retenida'));
  it('estatus descartada → no_aplica', () => expect(estadoRetencionDeBuzon('descartada').estado).toBe('no_aplica'));
  it('recibida / en_revision → no_retenida', () => {
    expect(estadoRetencionDeBuzon('recibida').estado).toBe('no_retenida');
    expect(estadoRetencionDeBuzon('en_revision').estado).toBe('no_retenida');
  });
});

describe('badgeEstadoRetencion', () => {
  it('rótulos y clases por estado', () => {
    expect(badgeEstadoRetencion(estadoRetencion(['iva'], ['iva'])).className).toContain('success');
    expect(badgeEstadoRetencion(estadoRetencion(['iva', 'islr'], ['iva'])).className).toContain('warning');
    expect(badgeEstadoRetencion(estadoRetencion(['iva'], [])).className).toContain('danger');
    expect(badgeEstadoRetencion(estadoRetencion([], [])).label).toMatch(/sin retención/i);
  });
});

describe('textoPago', () => {
  it('por pagar', () => expect(textoPago({ pagada: false })).toBe('Por pagar'));
  it('pagada en dólares', () => expect(textoPago({ pagada: true, montoPagado: 200, monedaPago: 'USD' })).toBe('✓ Pagada: $ 200,00'));
});
