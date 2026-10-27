/* ============================================================
   La ventana del libro de un mercado y su cierre manual (27-10-2026).

   Regla: un mercado ABIERTO toma todo lo que pasa hasta AHORA, sin plazo;
   su contraste es contra el stock de ahora y no tiene «inventario al <fecha>».
   Un mercado CERRADO termina en el instante del cierre y su snapshot manda.
   ============================================================ */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fechaCierreDe, inventarioAlDe, ventana, type CierreSnapshot } from './mercados.repository';

const AHORA = '2026-10-27T18:30:00.000Z';

describe('ventana — hasta dónde llega el libro', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(AHORA)); });
  afterEach(() => { vi.useRealTimers(); });

  it('un abierto que ya pasó su antigua fecha planificada llega hasta AHORA (Los Pinos #3)', () => {
    // Arrancó el 29-09 a las 16:08Z; el ciclo de 21 días «vencía» el 19-10 y lo dejaron abierto.
    // Las comidas del 20 al 27 tienen que entrar: la ventana no corta en ninguna fecha de fin.
    const v = ventana({ fecha_inicio: '2026-09-29', inicio_at: '2026-09-29T16:08:17.517Z', cerrado_en: null, cierre: null });
    expect(v.desde).toBe('2026-09-29T16:08:17.517Z');
    expect(v.hasta).toBe(AHORA);
  });

  it('un abierto en curso también llega hasta ahora', () => {
    const v = ventana({ fecha_inicio: '2026-10-25', inicio_at: '2026-10-25T12:00:00.000Z' });
    expect(v.hasta).toBe(AHORA);
  });

  it('sin instante de apertura arranca a las 00:00 locales de su fecha de inicio', () => {
    const v = ventana({ fecha_inicio: '2026-10-25' });
    expect(v.desde).toBe(new Date('2026-10-25T00:00:00').toISOString());
  });

  it('un cerrado termina en el instante exacto del cierre, como antes', () => {
    const v = ventana({ fecha_inicio: '2026-09-29', inicio_at: '2026-09-29T16:08:17.517Z', cerrado_en: '2026-10-20T14:00:00.000Z' });
    expect(v.hasta).toBe('2026-10-20T14:00:00.000Z');
  });

  it('un descartado termina en el instante del descarte', () => {
    const cierre = { descartado: true, generado_en: '2026-09-14T20:50:00.000Z' } as CierreSnapshot;
    const v = ventana({ fecha_inicio: '2026-09-14', inicio_at: '2026-09-14T20:38:00.000Z', cerrado_en: '2026-09-14T20:50:00.000Z', cierre });
    expect(v.hasta).toBe('2026-09-14T20:50:00.000Z');
  });
});

describe('inventarioAlDe — el contraste del abierto es contra el stock de ahora', () => {
  it('abierto: null, aunque tenga una fecha de fin vieja', () => {
    expect(inventarioAlDe({ estado: 'abierto', cierre: null })).toBeNull();
  });

  it('cerrado viejo: la fecha que dejó su cierre', () => {
    expect(inventarioAlDe({ estado: 'cerrado', cierre: { inventario_al: '2026-09-11' } as CierreSnapshot })).toBe('2026-09-11');
  });

  it('cerrado nuevo (sin fecha): null', () => {
    expect(inventarioAlDe({ estado: 'cerrado', cierre: { inventario_al: null } as CierreSnapshot })).toBeNull();
  });
});

describe('fechaCierreDe — la fecha fin que se muestra', () => {
  it('abierto: no tiene fin', () => {
    expect(fechaCierreDe({ estado: 'abierto', fecha_fin: null, cerrado_en: null })).toBeNull();
    // Un abierto anterior al cambio todavía trae la fecha planificada vieja: se ignora.
    expect(fechaCierreDe({ estado: 'abierto', fecha_fin: '2026-10-19', cerrado_en: null })).toBeNull();
  });

  it('cerrado: la fecha local del instante del cierre manda sobre la planificada vieja', () => {
    const local = new Date('2026-10-20T14:00:00.000Z');
    const esperada = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
    expect(fechaCierreDe({ estado: 'cerrado', fecha_fin: '2026-10-19', cerrado_en: '2026-10-20T14:00:00.000Z' })).toBe(esperada);
  });

  it('cerrado sin instante: lo que diga fecha_fin', () => {
    expect(fechaCierreDe({ estado: 'cerrado', fecha_fin: '2026-09-11', cerrado_en: null })).toBe('2026-09-11');
  });
});
