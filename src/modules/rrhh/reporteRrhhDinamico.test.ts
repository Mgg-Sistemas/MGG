import { describe, expect, it } from 'vitest';
import type { Personal } from '@/shared/lib/types';
import type { DefinicionEmpresa } from './empresa';
import type { CambioSueldoRegistro, FamiliarPersonal } from './personal.repository';
import type { HistorialTabulador } from './tabulador';
import {
  normalizarPersonalRrhh,
  normalizarHistoricoSalarialRrhh,
  normalizarHistoricoCargosRrhh,
  filtrarFilasRrhh,
  procesarFilasReporteRrhh,
  calcularResumenRrhh,
  obtenerMetricasFichaRrhh,
  calcularAntiguedad,
  rangoSalarialDe,
} from './reporteRrhhDinamico';

describe('reporteRrhhDinamico - Utilidades', () => {
  it('calcula rangos salariales correctamente', () => {
    expect(rangoSalarialDe(0)).toBe('Sin sueldo cargado');
    expect(rangoSalarialDe(150)).toBe('Menor a $ 200');
    expect(rangoSalarialDe(350)).toBe('$ 200 a $ 400');
    expect(rangoSalarialDe(500)).toBe('$ 400 a $ 700');
    expect(rangoSalarialDe(850)).toBe('$ 700 a $ 1,000');
    expect(rangoSalarialDe(1500)).toBe('Mayor a $ 1,000');
  });

  it('calcula antigüedad en texto y años', () => {
    expect(calcularAntiguedad(null).texto).toBe('-');
    expect(calcularAntiguedad('').texto).toBe('-');
    const hoy = new Date();
    const hace2Anios = new Date(hoy.getFullYear() - 2, hoy.getMonth(), hoy.getDate()).toISOString().slice(0, 10);
    const res = calcularAntiguedad(hace2Anios);
    expect(res.anios).toBe(2);
    expect(res.texto).toContain('2a');
  });
});

describe('reporteRrhhDinamico - Personal y Carga Familiar', () => {
  const empresas: DefinicionEmpresa[] = [
    { key: 'MGG', label: 'MGG', razonSocial: 'Mineral Group Guayana', rif: 'J-12345678-0', icono: '🏢', color: '#ff8a00', orden: 1, activa: true, monedaPago: 'USD' },
    { key: 'MTO', label: 'MTO', razonSocial: 'Minera El Callao', rif: 'J-87654321-0', icono: '⛏', color: '#3498db', orden: 2, activa: true, monedaPago: 'USD' },
  ];
  const mapaEmpresas = new Map(empresas.map((e) => [e.key, e]));

  const personal: Personal[] = [
    {
      id: 'p1',
      nombre: 'Carlos',
      apellido: 'Perez',
      cedula: 'V-10200300',
      cargo: 'OPERADOR',
      departamento: 'Operaciones',
      sueldo_base: 450,
      activo: true,
      empresa: 'MGG',
      genero: 'masculino',
      fecha_ingreso: '2022-01-15',
      created_at: '2022-01-15T00:00:00Z',
    },
    {
      id: 'p2',
      nombre: 'Maria',
      apellido: 'Gomez',
      cedula: 'V-15600700',
      cargo: 'ADMINISTRADORA',
      departamento: 'Administración',
      sueldo_base: 800,
      activo: true,
      empresa: 'MGG',
      genero: 'femenino',
      fecha_ingreso: '2021-06-01',
      created_at: '2021-06-01T00:00:00Z',
    },
    {
      id: 'p3',
      nombre: 'Juan',
      apellido: 'Rivas',
      cedula: 'V-20111222',
      cargo: 'VIGILANTE',
      departamento: 'Seguridad',
      sueldo_base: 300,
      activo: false,
      empresa: 'MTO',
      genero: 'masculino',
      fecha_ingreso: '2023-03-10',
      created_at: '2023-03-10T00:00:00Z',
    },
  ];

  // Carlos tiene 2 hijos (uno menor, uno mayor). Maria no tiene hijos. Juan tiene 1 cónyuge pero no hijos.
  const mapaFamilia = new Map<string, FamiliarPersonal[]>([
    [
      'p1',
      [
        { id: 'f1', personalId: 'p1', nombre: 'Carlitos', parentesco: 'hijo', fechaNacimiento: '2018-05-10', genero: 'masculino', observacion: null, createdAt: '' },
        { id: 'f2', personalId: 'p1', nombre: 'Carla', parentesco: 'hijo', fechaNacimiento: '2000-01-01', genero: 'femenino', observacion: null, createdAt: '' },
      ],
    ],
    [
      'p3',
      [
        { id: 'f3', personalId: 'p3', nombre: 'Ana (Esposa)', parentesco: 'conyuge', fechaNacimiento: '1985-02-14', genero: 'femenino', observacion: null, createdAt: '' },
      ],
    ],
  ]);

  const tasaBcv = 42.5;

  it('normaliza personal detectando hijos y menores de edad', () => {
    const filas = normalizarPersonalRrhh(personal, mapaEmpresas, tasaBcv, mapaFamilia);
    expect(filas).toHaveLength(3);

    const carlos = filas.find((f) => f.id === 'p1')!;
    expect(carlos.tieneHijos).toBe(true);
    expect(carlos.cantidadHijos).toBe(2);
    expect(carlos.hijosMenores).toBe(1); // Carlitos nació en 2018 (<18 años)
    expect(carlos.cargaFamiliar).toBe(2);
    expect(carlos.empresaNombre).toBe('Mineral Group Guayana');
    expect(carlos.sueldoBs).toBe(450 * 42.5);

    const maria = filas.find((f) => f.id === 'p2')!;
    expect(maria.tieneHijos).toBe(false);
    expect(maria.cantidadHijos).toBe(0);

    const juan = filas.find((f) => f.id === 'p3')!;
    expect(juan.tieneHijos).toBe(false); // Tiene cónyuge pero NO hijos
    expect(juan.cargaFamiliar).toBe(1);
    expect(juan.empresaNombre).toBe('Minera El Callao');
  });

  it('filtra por con_hijos y sin_hijos', () => {
    const filas = normalizarPersonalRrhh(personal, mapaEmpresas, tasaBcv, mapaFamilia);

    const soloConHijos = filtrarFilasRrhh(filas, { filtroHijos: 'con_hijos' });
    expect(soloConHijos).toHaveLength(1);
    expect(soloConHijos[0].id).toBe('p1');

    const soloSinHijos = filtrarFilasRrhh(filas, { filtroHijos: 'sin_hijos' });
    expect(soloSinHijos).toHaveLength(2);
    expect(soloSinHijos.map((x) => x.id)).toEqual(['p2', 'p3']);
  });

  it('filtra multi-empresa por checks', () => {
    const filas = normalizarPersonalRrhh(personal, mapaEmpresas, tasaBcv, mapaFamilia);

    const soloMto = filtrarFilasRrhh(filas, { empresasSel: ['MTO'] });
    expect(soloMto).toHaveLength(1);
    expect(soloMto[0].id).toBe('p3');

    const ambas = filtrarFilasRrhh(filas, { empresasSel: ['MGG', 'MTO'] });
    expect(ambas).toHaveLength(3);
  });

  it('agrupa por carga familiar', () => {
    const filas = normalizarPersonalRrhh(personal, mapaEmpresas, tasaBcv, mapaFamilia);
    const grupos = procesarFilasReporteRrhh(filas, 'carga_familiar', tasaBcv);

    expect(grupos.length).toBeGreaterThanOrEqual(2);
    const grupoHijos = grupos.find((g) => g.tieneHijos)!;
    expect(grupoHijos).toBeDefined();
    expect(grupoHijos.cantidadHijos).toBe(2);
    expect(grupoHijos.totalPersonas).toBe(1);

    const grupoSinHijos = grupos.find((g) => !g.tieneHijos)!;
    expect(grupoSinHijos).toBeDefined();
    expect(grupoSinHijos.totalPersonas).toBe(2);
  });

  it('agrupa por empresa y calcula porcentajes sobre masa salarial', () => {
    const filas = normalizarPersonalRrhh(personal, mapaEmpresas, tasaBcv, mapaFamilia);
    const grupos = procesarFilasReporteRrhh(filas, 'empresa', tasaBcv);

    expect(grupos).toHaveLength(2);
    const gMgg = grupos.find((g) => g.empresaKey === 'MGG')!;
    expect(gMgg.totalPersonas).toBe(2);
    expect(gMgg.masaSalarialUsd).toBe(450 + 800); // 1250

    const gMto = grupos.find((g) => g.empresaKey === 'MTO')!;
    expect(gMto.totalPersonas).toBe(1);
    expect(gMto.masaSalarialUsd).toBe(300);
  });

  it('calcula resumen y KPIs con estadísticas familiares', () => {
    const filas = normalizarPersonalRrhh(personal, mapaEmpresas, tasaBcv, mapaFamilia);
    const res = calcularResumenRrhh(filas, tasaBcv, empresas);

    expect(res.totalPersonas).toBe(3);
    expect(res.activos).toBe(2);
    expect(res.inactivos).toBe(1);
    expect(res.hombres).toBe(2);
    expect(res.mujeres).toBe(1);
    expect(res.conHijos).toBe(1);
    expect(res.sinHijos).toBe(2);
    expect(res.totalHijos).toBe(2);
    expect(res.totalHijosMenores).toBe(1);
    expect(res.conCargaFamiliar).toBe(2); // Carlos (hijos) + Juan (cónyuge)
    expect(res.masaSalarialUsd).toBe(450 + 800 + 300);
    expect(res.sueldoPromedioUsd).toBe(Math.round(((450 + 800 + 300) / 3) * 100) / 100);

    const kpis = obtenerMetricasFichaRrhh(res, 'personal');
    expect(kpis).toHaveLength(4);
    expect(kpis.some((k) => k.clave === 'hijos_familia')).toBe(true);
  });
});

describe('reporteRrhhDinamico - Histórico Salarial', () => {
  const empresas: DefinicionEmpresa[] = [
    { key: 'MGG', label: 'MGG', razonSocial: 'Mineral Group Guayana', rif: 'J-12345678-0', icono: '🏢', color: '#ff8a00', orden: 1, activa: true, monedaPago: 'USD' },
  ];
  const mapaEmpresas = new Map(empresas.map((e) => [e.key, e]));

  const personal: Personal[] = [
    { id: 'p1', nombre: 'Carlos', apellido: 'Perez', cedula: 'V-10200300', cargo: 'OPERADOR', sueldo_base: 500, activo: true, empresa: 'MGG', created_at: '' },
  ];

  const cambios: CambioSueldoRegistro[] = [
    {
      id: 'c1',
      personalId: 'p1',
      sueldoAnterior: 400,
      sueldoNuevo: 500,
      vigenteDesde: '2026-10-01',
      motivo: 'Aumento por desempeño',
      tipo: 'individual',
      actorEmail: 'admin@mgg.com',
      actorName: 'Administradora MGG',
      createdAt: '2026-10-01T10:00:00Z',
    },
  ];

  it('normaliza cambios salariales y calcula variaciones en $ y %', () => {
    const filas = normalizarHistoricoSalarialRrhh(cambios, personal, mapaEmpresas, 40);
    expect(filas).toHaveLength(1);
    expect(filas[0].variacionUsd).toBe(100);
    expect(filas[0].variacionPct).toBe(25); // (100 / 400) * 100
    expect(filas[0].motivo).toBe('Aumento por desempeño');
    expect(filas[0].autor).toBe('Administradora MGG');
  });
});

describe('reporteRrhhDinamico - Histórico de Cargos / Tabulador', () => {
  const personal: Personal[] = [
    { id: 'p1', nombre: 'Carlos', cargo: 'OPERADOR', sueldo_base: 500, activo: true, created_at: '' },
    { id: 'p2', nombre: 'Pedro', cargo: 'OPERADOR', sueldo_base: 500, activo: true, created_at: '' },
  ];

  const historial: HistorialTabulador[] = [
    {
      id: 'h1',
      tabuladorId: 't1',
      cargo: 'OPERADOR',
      accion: 'cambio',
      sueldoAnterior: 450,
      sueldoNuevo: 500,
      vigenteDesde: '2026-10-15',
      motivo: 'Ajuste general de tabulador',
      cambiadoPor: 'admin@mgg.com',
      cambiadoPorNombre: 'Gerente General',
      createdAt: '2026-10-15T08:00:00Z',
    },
  ];

  it('normaliza histórico de cargos calculando ocupantes y costo mensual', () => {
    const filas = normalizarHistoricoCargosRrhh(historial, personal, 40);
    expect(filas).toHaveLength(1);
    expect(filas[0].cargo).toBe('OPERADOR');
    expect(filas[0].personasEnCargo).toBe(2);
    expect(filas[0].costoCargoUsd).toBe(1000); // 2 * 500
    expect(filas[0].variacionUsd).toBe(50);
  });
});

