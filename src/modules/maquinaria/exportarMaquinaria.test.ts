import { describe, it, expect } from 'vitest';
import {
  CAMPOS_EXPORT_MAQUINARIA,
  CAMPOS_POR_DEFECTO_MAQUINARIA,
  tablaExportMaquinaria,
} from './exportarMaquinaria';
import type { MaquinariaEquipo } from './maquinariaEquipos.repository';

const mockEquipo = (overrides: Partial<MaquinariaEquipo> = {}): MaquinariaEquipo => ({
  id: 'eq-1',
  equipo: 'EXCAVADORA 320D',
  tipo: 'FLOTA PESADA',
  propietario: 'MINERAL GROUP GUAYANA',
  responsable: 'Carlos Mendoza',
  status: 'ACTIVO',
  ubicacion: 'Frente Mina',
  anio: 2021,
  marca: 'CAT',
  modelo: '320D',
  color: 'Amarillo',
  serial: 'CAT-1234',
  placa: 'MGG-01',
  motor_modelo: 'C6.4',
  motor_serial: 'ENG-5678',
  combustible: 'DIESEL',
  litros_consume: 18,
  ficha_tecnica: null,
  ficha_mantenimiento: null,
  documentacion: null,
  mantenimiento_cada_hrs: 250,
  mantenimiento_cada_km: null,
  mantenimiento_base_hrs: null,
  mantenimiento_base_km: null,
  combustible_equipo: null,
  activo: true,
  ...overrides,
});

describe('exportarMaquinaria', () => {
  it('CAMPOS_EXPORT_MAQUINARIA define campos clave de identidad, ficha, mantenimiento y combustible', () => {
    const keys = CAMPOS_EXPORT_MAQUINARIA.map((c) => c.key);
    expect(keys).toContain('equipo');
    expect(keys).toContain('propietario');
    expect(keys).toContain('responsable');
    expect(keys).toContain('horometro');
    expect(keys).toContain('horas_restantes');
    expect(keys).toContain('placa');
  });

  it('tablaExportMaquinaria genera encabezados y filas para los campos elegidos', () => {
    const eq = mockEquipo();
    const { head, filas } = tablaExportMaquinaria([eq], ['equipo', 'propietario', 'responsable']);
    expect(head).toEqual(['N°', 'Equipo / Código', 'Empresa / Propietario', 'Encargado responsable']);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toEqual([1, 'EXCAVADORA 320D', 'MINERAL GROUP GUAYANA', 'Carlos Mendoza']);
  });

  it('tablaExportMaquinaria agrupa por empresa / propietario cuando se solicita', () => {
    const eq1 = mockEquipo({ id: 'eq-1', equipo: 'JUMBO 01', propietario: 'MINERAL GROUP GUAYANA' });
    const eq2 = mockEquipo({ id: 'eq-2', equipo: 'CAMIONETA 01', propietario: 'GOLDEN TOUCH 1127' });
    const eq3 = mockEquipo({ id: 'eq-3', equipo: 'MOTO 01', propietario: 'MINERAL GROUP GUAYANA' });

    const { grupos } = tablaExportMaquinaria(
      [eq1, eq2, eq3],
      ['equipo', 'propietario'],
      undefined,
      true, // agruparPorEmpresa
    );

    expect(grupos).toHaveLength(2);
    // Orden alfabético
    expect(grupos[0].empresa).toBe('GOLDEN TOUCH 1127');
    expect(grupos[0].equipos).toHaveLength(1);
    expect(grupos[1].empresa).toBe('MINERAL GROUP GUAYANA');
    expect(grupos[1].equipos).toHaveLength(2);
  });
});
