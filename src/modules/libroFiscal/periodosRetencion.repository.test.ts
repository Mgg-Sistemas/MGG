import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('@/shared/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { declararPeriodo, generarPeriodos, periodoEstaCerrado, reabrirPeriodo } from './periodosRetencion.repository';

beforeEach(() => { rpc.mockReset(); });

describe('períodos (V3): las funciones devuelven cuántas retenciones tocaron', () => {
  it('generar manda el año y devuelve cuántos períodos creó', async () => {
    rpc.mockResolvedValueOnce({ data: 36, error: null });
    expect(await generarPeriodos(2026)).toBe(36);
    expect(rpc).toHaveBeenCalledWith('retencion_periodos_generar', { p_anio: 2026 });
  });

  it('declarar con filas: éxito con el conteo', async () => {
    rpc.mockResolvedValueOnce({ data: 12, error: null });
    const r = await declararPeriodo('per-1');
    expect(rpc).toHaveBeenCalledWith('retencion_periodo_declarar', { p_id: 'per-1' });
    expect(r).toMatchObject({ filas: 12, enCero: false });
    expect(r.mensaje).toContain('12 retenciones');
  });

  it('declarar con 0: no es un «hecho» sin más, viene como aviso de declaración en cero', async () => {
    rpc.mockResolvedValueOnce({ data: 0, error: null });
    const r = await declararPeriodo('per-1');
    expect(r.enCero).toBe(true);
    expect(r.mensaje).toContain('sin retenciones');
  });

  it('declarar uno ya declarado o sin permiso: error legible', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'RET_PERIODO_YA_DECLARADO: el período ya está declarado.' } });
    await expect(declararPeriodo('per-1')).rejects.toThrow('ya estaba declarado');
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'RET_SIN_PERMISO: hace falta el permiso de Retenciones.' } });
    await expect(declararPeriodo('per-1')).rejects.toThrow('No tienes permiso');
  });

  it('reabrir exige motivo antes de llamar a la base', async () => {
    await expect(reabrirPeriodo('per-1', '   ')).rejects.toThrow('motivo');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('reabrir manda el motivo limpio; con 0 avisa, con filas da el conteo', async () => {
    rpc.mockResolvedValueOnce({ data: 1, error: null });
    const r = await reabrirPeriodo('per-1', '  Corrección de una factura  ');
    expect(rpc).toHaveBeenCalledWith('retencion_periodo_reabrir', { p_id: 'per-1', p_motivo: 'Corrección de una factura' });
    expect(r.mensaje).toContain('1 retención');
    rpc.mockResolvedValueOnce({ data: 0, error: null });
    expect((await reabrirPeriodo('per-1', 'Revisión')).enCero).toBe(true);
  });

  it('reabrir uno no declarado: error legible', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'RET_PERIODO_NO_DECLARADO: el período no está declarado.' } });
    await expect(reabrirPeriodo('per-1', 'Revisión')).rejects.toThrow('no está declarado');
  });

  it('periodoEstaCerrado devuelve null ante fechas no válidas', async () => {
    expect(await periodoEstaCerrado('iva', '')).toBeNull();
    expect(await periodoEstaCerrado('iva', '2026-99-99')).toBeNull();
  });
});

