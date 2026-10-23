import { afterEach, describe, expect, it, vi } from 'vitest';
import { hoyVenezuela } from '@/shared/lib/rangosFecha';
import { estadoPeriodo } from './periodosRetencion.repository';

afterEach(() => { vi.useRealTimers(); });

describe('«hoy» es el día de Venezuela, no el de UTC (D41, Lote 1)', () => {
  it('a las 21:00 VET del 20/10 sigue siendo el 20/10 (en UTC ya es el 21)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T01:00:00Z'));
    expect(new Date().toISOString().slice(0, 10)).toBe('2026-10-21');
    expect(hoyVenezuela()).toBe('2026-10-20');
  });

  it('el estado de un período usa el día de Venezuela por defecto', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T01:00:00Z'));
    // Vence el 20/10: a las 21:00 VET todavía no está vencido.
    expect(estadoPeriodo({ declaradoEn: null, declara: 'gt', vence: '2026-10-20' })).toBe('abierto');
  });
});
