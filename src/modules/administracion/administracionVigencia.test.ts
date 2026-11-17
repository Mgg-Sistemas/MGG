import { describe, it, expect } from 'vitest';
import {
  sumarTiempoVigencia,
  calcularStatusPorCercania,
  obtenerDetalleHoverVigencia,
  statusConAviso,
  ordenPrioridad,
  PRESETS_TIEMPO_VIGENCIA,
} from './administracionVigencia';

describe('statusConAviso (umbral por aviso_dias del ítem)', () => {
  const HOY = '2026-11-07';
  const en = (dias: number) => sumarTiempoVigencia(HOY, dias, 'dias');
  it('con avisoDias=60 y 45 días por vencer → por_vencer (con 30 fijo sería vigente)', () => {
    expect(statusConAviso(en(45), 60, { hoyRef: HOY })).toBe('por_vencer');
    expect(statusConAviso(en(45), null, { hoyRef: HOY })).toBe('vigente'); // null → 30
  });
  it('vencido, en trámite, sin fecha', () => {
    expect(statusConAviso(en(-5), 30, { hoyRef: HOY })).toBe('vencido');
    expect(statusConAviso(en(-5), 30, { hoyRef: HOY, statusManual: 'vencido_en_tramite' })).toBe('vencido_en_tramite');
    expect(statusConAviso(null, 30, { hoyRef: HOY })).toBe('no_vence');
  });
});

describe('ordenPrioridad', () => {
  it('alta < media < baja < null', () => {
    const ps: (import('./admin.repository').Prioridad | null)[] = [null, 'baja', 'alta', 'media'];
    expect(ps.map(ordenPrioridad)).toEqual([3, 2, 0, 1]);
  });
});

describe('administracionVigencia', () => {
  it('suma días correctamente a una fecha base', () => {
    const f15 = sumarTiempoVigencia('2026-11-01', 15, 'dias');
    expect(f15).toBe('2026-11-16');

    const f30 = sumarTiempoVigencia('2026-11-01', 30, 'dias');
    expect(f30).toBe('2026-12-01');
  });

  it('suma meses y años correctamente a una fecha base', () => {
    const f1m = sumarTiempoVigencia('2026-01-15', 1, 'meses');
    expect(f1m).toBe('2026-02-15');

    const f3m = sumarTiempoVigencia('2026-01-15', 3, 'meses');
    expect(f3m).toBe('2026-04-15');

    const f1a = sumarTiempoVigencia('2026-05-10', 1, 'anos');
    expect(f1a).toBe('2027-05-10');

    const f5a = sumarTiempoVigencia('2026-05-10', 5, 'anos');
    expect(f5a).toBe('2031-05-10');
  });

  it('asigna status "no_vence" cuando no hay fecha o se marca permanente', () => {
    const resVacio = calcularStatusPorCercania(null);
    expect(resVacio.status).toBe('no_vence');
    expect(resVacio.dias).toBeNull();
    expect(resVacio.badgeLabel).toBe('Permanente');

    const resManual = calcularStatusPorCercania('2026-12-01', { statusManual: 'no_vence' });
    expect(resManual.status).toBe('no_vence');
  });

  it('asigna status "vencido" cuando la fecha ya pasó', () => {
    // 5 días en el pasado con respecto a hoyRef
    const res = calcularStatusPorCercania('2026-11-01', { hoyRef: '2026-11-06' });
    expect(res.status).toBe('vencido');
    expect(res.dias).toBe(-5);
    expect(res.urgente).toBe(true);
    expect(res.label).toContain('Caducó hace 5 días');
  });

  it('asigna status "vencido_en_tramite" cuando está vencido pero con trámite activo', () => {
    const res = calcularStatusPorCercania('2026-10-15', { esTramite: true, hoyRef: '2026-11-06' });
    expect(res.status).toBe('vencido_en_tramite');
    expect(res.urgente).toBe(true);
    expect(res.badgeLabel).toContain('En trámite');
  });

  it('asigna status "por_vencer" y urgencia cuando faltan <= 15 días', () => {
    const res = calcularStatusPorCercania('2026-11-15', { hoyRef: '2026-11-06' });
    expect(res.status).toBe('por_vencer');
    expect(res.dias).toBe(9);
    expect(res.urgente).toBe(true);
    expect(res.badgeLabel).toBe('Vence en 9d');
  });

  it('asigna status "por_vencer" cuando faltan entre 16 y 30 días', () => {
    const res = calcularStatusPorCercania('2026-11-30', { hoyRef: '2026-11-06' });
    expect(res.status).toBe('por_vencer');
    expect(res.dias).toBe(24);
    expect(res.urgente).toBe(false);
  });

  it('asigna status "vigente" cuando faltan más de 30 días', () => {
    const res90 = calcularStatusPorCercania('2027-01-06', { hoyRef: '2026-11-06' });
    expect(res90.status).toBe('vigente');
    expect(res90.dias).toBe(61);
    expect(res90.urgente).toBe(false);

    const res1a = calcularStatusPorCercania('2027-11-06', { hoyRef: '2026-11-06' });
    expect(res1a.status).toBe('vigente');
    expect(res1a.dias).toBe(365);
    expect(res1a.badgeLabel).toContain('Vigente');
  });

  it('incluye catálogo completo de presets de vigencia', () => {
    expect(PRESETS_TIEMPO_VIGENCIA.length).toBeGreaterThanOrEqual(7);
    expect(PRESETS_TIEMPO_VIGENCIA.some((p) => p.id === '15d')).toBe(true);
    expect(PRESETS_TIEMPO_VIGENCIA.some((p) => p.id === '1a')).toBe(true);
    expect(PRESETS_TIEMPO_VIGENCIA.some((p) => p.id === 'no_vence')).toBe(true);
  });

  it('genera detalle hover completo con días y tiempo restante', () => {
    const hover1 = obtenerDetalleHoverVigencia('2026-11-20', undefined, undefined, '2026-11-06');
    expect(hover1.dias).toBe(14);
    expect(hover1.badge).toBe('Vence en 14d');
    expect(hover1.tiempoRestanteTexto).toContain('Quedan 14 días');

    const hoverVencido = obtenerDetalleHoverVigencia('2026-10-01', 'vencido', 'En renovación', '2026-11-06');
    expect(hoverVencido.dias).toBe(-36);
    expect(hoverVencido.tiempoRestanteTexto).toContain('Venció hace 36 días');
    expect(hoverVencido.detalle).toContain('Nota de trámite: En renovación');

    const hoverPerm = obtenerDetalleHoverVigencia(null, 'no_vence');
    expect(hoverPerm.tiempoRestanteTexto).toBe('Sin caducidad (Vigente permanente)');
  });
});
