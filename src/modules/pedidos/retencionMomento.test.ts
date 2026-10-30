import { describe, expect, it } from 'vitest';
import type { Orden } from '@/shared/lib/types';
import {
  colaRetencion, errorPagoRetencionPendiente, esperaRetencionAntesDePagar, etiquetaRetencionMomento,
  patchRetencionMomento, repartirColasRetencion,
} from './retencionMomento';

const o = (over: Partial<Orden>): Orden => ({
  id: 'x', codigo: 'SP-1', oc_codigo: 'OC-2026-0300', estado: 'oc_aprobada', ...over,
} as Orden);

describe('esperaRetencionAntesDePagar / errorPagoRetencionPendiente', () => {
  it('frena solo la que se retiene ANTES y todavía no está hecha', () => {
    expect(esperaRetencionAntesDePagar(o({ retencion_momento: 'antes' }))).toBe(true);
    expect(esperaRetencionAntesDePagar(o({ retencion_momento: 'antes', retencion_hecha_en: '2026-10-30T10:00:00Z' }))).toBe(false);
    expect(esperaRetencionAntesDePagar(o({ retencion_momento: 'despues' }))).toBe(false);
    expect(esperaRetencionAntesDePagar(o({}))).toBe(false);
  });
  it('da un mensaje claro con el código de la OC', () => {
    expect(errorPagoRetencionPendiente(o({ retencion_momento: 'antes' }))).toMatch(/OC-2026-0300 se retiene ANTES de pagar/);
    expect(errorPagoRetencionPendiente(o({ retencion_momento: 'despues' }))).toBeNull();
    expect(errorPagoRetencionPendiente(o({ oc_codigo: null, retencion_momento: 'antes' }))).toMatch(/SP-1/);
  });
});

describe('patchRetencionMomento', () => {
  it('sin momento (flujo apagado) no toca nada', () => {
    expect(patchRetencionMomento(o({}), null)).toEqual({});
    expect(patchRetencionMomento(o({}), undefined)).toEqual({});
  });
  it('si cambia, borra la retención marcada', () => {
    expect(patchRetencionMomento(o({ retencion_momento: 'despues' }), 'antes')).toEqual({
      retencion_momento: 'antes', retencion_hecha_en: null, retencion_hecha_por: null, retencion_nota: null,
    });
    expect(patchRetencionMomento(o({}), 'despues')).toEqual({
      retencion_momento: 'despues', retencion_hecha_en: null, retencion_hecha_por: null, retencion_nota: null,
    });
  });
  it('si es el mismo, conserva lo marcado', () => {
    expect(patchRetencionMomento(o({ retencion_momento: 'antes' }), 'antes')).toEqual({ retencion_momento: 'antes' });
  });
});

describe('colaRetencion / repartirColasRetencion', () => {
  it('antes: confirmada o confirmada pagar; después: solo pagada', () => {
    expect(colaRetencion(o({ retencion_momento: 'antes', estado: 'oc_aprobada' }))).toBe('antes');
    expect(colaRetencion(o({ retencion_momento: 'antes', estado: 'confirmada_metodo' }))).toBe('antes');
    expect(colaRetencion(o({ retencion_momento: 'antes', estado: 'pagada' }))).toBeNull();
    expect(colaRetencion(o({ retencion_momento: 'despues', estado: 'oc_aprobada' }))).toBeNull();
    expect(colaRetencion(o({ retencion_momento: 'despues', estado: 'pagada' }))).toBe('despues');
    expect(colaRetencion(o({ retencion_momento: 'despues', estado: 'pagada', retencion_hecha_en: '2026-10-30' }))).toBeNull();
    expect(colaRetencion(o({ estado: 'pagada' }))).toBeNull();
  });
  it('reparte y ordena la más vieja primero', () => {
    const r = repartirColasRetencion([
      o({ id: 'a2', retencion_momento: 'antes', metodo_pago_en: '2026-10-30T12:00:00Z' }),
      o({ id: 'd1', retencion_momento: 'despues', estado: 'pagada', metodo_pago_en: '2026-10-29T12:00:00Z' }),
      o({ id: 'a1', retencion_momento: 'antes', metodo_pago_en: '2026-10-29T08:00:00Z' }),
      o({ id: 'n', estado: 'oc_aprobada' }),
    ]);
    expect(r.antes.map((x) => x.id)).toEqual(['a1', 'a2']);
    expect(r.despues.map((x) => x.id)).toEqual(['d1']);
  });
});

describe('etiquetaRetencionMomento', () => {
  it('textos del distintivo', () => {
    expect(etiquetaRetencionMomento(o({}))).toBeNull();
    expect(etiquetaRetencionMomento(o({ retencion_momento: 'antes' }))).toBe('Retención: antes de pagar · pendiente');
    expect(etiquetaRetencionMomento(o({ retencion_momento: 'despues', retencion_hecha_en: '2026-10-30' }))).toBe('Retención: después de pagar · hecha');
  });
});
