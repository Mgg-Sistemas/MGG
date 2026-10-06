import { describe, expect, it } from 'vitest';
import {
  FILTRO_ASIGNACIONES_VACIO, GRUPOS_ASIGNACION, TIPOS_ASIGNACION, filtrarAsignaciones, grupoDe, labelGrupo, tiposDelGrupo,
} from './asignaciones';

describe('asignaciones · tres clases', () => {
  it('todo tipo pertenece a una de las tres clases', () => {
    const claves = GRUPOS_ASIGNACION.map((g) => g.key);
    expect(claves).toEqual(['bienes', 'dotacion', 'vehiculos']);
    for (const t of TIPOS_ASIGNACION) expect(claves).toContain(t.grupo);
    expect(GRUPOS_ASIGNACION.flatMap((g) => tiposDelGrupo(g.key)).length).toBe(TIPOS_ASIGNACION.length);
  });

  it('ubica cada tipo (y los desconocidos) en su clase', () => {
    expect(grupoDe('dotacion')).toBe('dotacion');
    expect(grupoDe('epp')).toBe('dotacion');
    expect(grupoDe('equipo_electronico')).toBe('bienes');
    expect(grupoDe('vehiculo')).toBe('vehiculos');
    expect(grupoDe('lo_que_sea')).toBe('bienes');
    expect(labelGrupo('vehiculos')).toBe('Asignación de vehículos');
  });

  it('el vehículo pide placa y vuelve', () => {
    const v = TIPOS_ASIGNACION.find((t) => t.key === 'vehiculo');
    expect(v?.pidePlaca).toBe(true);
    expect(v?.retornable).toBe(true);
  });

  it('filtra por clase', () => {
    const filas = [
      { id: '1', personal_id: 'p', tipo: 'vehiculo', descripcion: 'Hilux', serial: 'AB123CD', numero_linea: null, estado: 'asignado', retornable: true, fecha_asignacion: '2026-10-06', historico: false },
      { id: '2', personal_id: 'p', tipo: 'dotacion', descripcion: 'Uniforme', serial: null, numero_linea: null, estado: 'asignado', retornable: false, fecha_asignacion: '2026-10-06', historico: false },
    ];
    expect(filtrarAsignaciones(filas, { ...FILTRO_ASIGNACIONES_VACIO, grupo: 'vehiculos' }).map((a) => a.id)).toEqual(['1']);
    expect(filtrarAsignaciones(filas, { ...FILTRO_ASIGNACIONES_VACIO, grupo: 'dotacion' }).map((a) => a.id)).toEqual(['2']);
    expect(filtrarAsignaciones(filas, FILTRO_ASIGNACIONES_VACIO)).toHaveLength(2);
  });
});
