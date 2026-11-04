import { describe, expect, it } from 'vitest';
import { celdasCambioCargo, errorCambioCargo, huboCambioCargo, ordenarCambiosCargo, textoCambioCargo, type CambioCargo } from './cambiosCargo';

const c = (x: Partial<CambioCargo>): CambioCargo => ({
  id: '1', personal_id: 'p', cargo_anterior: 'AYUDANTE', cargo_nuevo: 'OPERADOR', departamento_anterior: 'PLANTA', departamento_nuevo: 'PLANTA',
  fecha: '2026-11-04', motivo: 'Ascenso por desempeño', origen: 'ficha', actor: null, actor_name: null, created_at: '2026-11-04T12:00:00Z', ...x,
});

describe('histórico de cambios de cargo (04-11-2026)', () => {
  it('solo cuenta como cambio si el cargo de verdad cambió', () => {
    expect(huboCambioCargo('Ayudante', ' AYUDANTE ')).toBe(false);
    expect(huboCambioCargo('AYUDANTE', 'OPERADOR')).toBe(true);
    expect(huboCambioCargo('AYUDANTE', '')).toBe(false);
  });
  it('pide fecha (no futura) y motivo', () => {
    expect(errorCambioCargo({ cargoNuevo: 'X', fecha: '', motivo: 'ok ok', hoy: '2026-11-04' })).toMatch(/fecha/);
    expect(errorCambioCargo({ cargoNuevo: 'X', fecha: '2026-12-01', motivo: 'ok ok', hoy: '2026-11-04' })).toMatch(/futura/);
    expect(errorCambioCargo({ cargoNuevo: 'X', fecha: '2026-11-01', motivo: '', hoy: '2026-11-04' })).toMatch(/motivo/);
    expect(errorCambioCargo({ cargoNuevo: 'X', fecha: '2026-11-01', motivo: 'Ascenso', hoy: '2026-11-04' })).toBeNull();
  });
  it('ordena del más nuevo al más viejo y arma el texto', () => {
    const r = ordenarCambiosCargo([c({ id: 'a', fecha: '2026-01-01' }), c({ id: 'b', fecha: '2026-11-01' })]);
    expect(r.map((x) => x.id)).toEqual(['b', 'a']);
    expect(textoCambioCargo(c({ departamento_nuevo: 'MANTENIMIENTO' }))).toBe('AYUDANTE → OPERADOR (PLANTA → MANTENIMIENTO)');
    expect(celdasCambioCargo({ cambio: c({ origen: 'historico' }), persona: 'ANA', cedula: 'V-1', registro: 'JUAN' })[7]).toBe('JUAN (histórico)');
  });
});
