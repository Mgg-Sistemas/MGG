import { describe, expect, it } from 'vitest';
import {
  ESTATUS_KANBAN_DEFECTO,
  LISTA_ESTATUS_KANBAN,
  esOrdenCanceladaOAnulada,
  estatusKanbanHabilitados,
  ordenTieneEstatusRetencion,
} from './retencionesKanban';
import { ordenAplicaRetencion } from './retenciones.repository';
import type { Orden } from '@/shared/lib/types';

describe('retencionesKanban', () => {
  it('excluye canceladas y anuladas de los estatus por defecto', () => {
    expect(ESTATUS_KANBAN_DEFECTO).not.toContain('cancelada');
    expect(ESTATUS_KANBAN_DEFECTO).not.toContain('anulada');
    expect(ESTATUS_KANBAN_DEFECTO).not.toContain('desistida_proveedor');
    expect(LISTA_ESTATUS_KANBAN.length).toBeGreaterThan(5);
  });

  it('detecta órdenes canceladas y anuladas', () => {
    expect(esOrdenCanceladaOAnulada('cancelada')).toBe(true);
    expect(esOrdenCanceladaOAnulada('anulada')).toBe(true);
    expect(esOrdenCanceladaOAnulada('desistida_proveedor')).toBe(true);
    expect(esOrdenCanceladaOAnulada('oc_aprobada')).toBe(false);
    expect(esOrdenCanceladaOAnulada('pagada')).toBe(false);
  });

  it('verifica si una orden califica para retención según su estado', () => {
    expect(ordenTieneEstatusRetencion('oc_aprobada')).toBe(true);
    expect(ordenTieneEstatusRetencion('pagada')).toBe(true);
    expect(ordenTieneEstatusRetencion('cancelada')).toBe(false);
    expect(ordenTieneEstatusRetencion('anulada')).toBe(false);
    expect(ordenTieneEstatusRetencion('pendiente')).toBe(false);
  });

  it('estatusKanbanHabilitados respeta configuración o devuelve los recomendados', () => {
    expect(estatusKanbanHabilitados(null)).toEqual(ESTATUS_KANBAN_DEFECTO);
    expect(estatusKanbanHabilitados([])).toEqual(ESTATUS_KANBAN_DEFECTO);
    expect(estatusKanbanHabilitados(['pagada', 'finalizada'])).toEqual(['pagada', 'finalizada']);
  });

  it('ordenAplicaRetencion rechaza órdenes canceladas o fuera de los estatus permitidos', () => {
    const ordenCancelada = {
      id: 'oc-c',
      estado: 'cancelada',
      created_at: '2026-10-15T00:00:00Z',
    } as Orden;

    const ordenAnulada = {
      id: 'oc-a',
      estado: 'anulada',
      created_at: '2026-10-15T00:00:00Z',
    } as Orden;

    const ordenAprobada = {
      id: 'oc-ok',
      estado: 'oc_aprobada',
      created_at: '2026-10-15T00:00:00Z',
    } as Orden;

    expect(ordenAplicaRetencion(ordenCancelada, '2026-10-01')).toBe(false);
    expect(ordenAplicaRetencion(ordenAnulada, '2026-10-01')).toBe(false);
    expect(ordenAplicaRetencion(ordenAprobada, '2026-10-01')).toBe(true);
  });
});
