import { describe, expect, it } from 'vitest';
import type { Personal } from '@/shared/lib/types';
import {
  edadCumplida,
  esBisiesto,
  esCumpleanosHoy,
  obtenerCumpleaneros,
} from './cumpleanos';

describe('esBisiesto', () => {
  it('detecta años bisiestos y no bisiestos correctamente', () => {
    expect(esBisiesto(2024)).toBe(true);
    expect(esBisiesto(2026)).toBe(false);
    expect(esBisiesto(2000)).toBe(true);
    expect(esBisiesto(1900)).toBe(false);
  });
});

describe('esCumpleanosHoy', () => {
  it('es true si el día y mes coinciden con la fecha actual', () => {
    expect(esCumpleanosHoy('1990-11-06', '2026-11-06')).toBe(true);
    expect(esCumpleanosHoy('2000-01-15', '2026-01-15')).toBe(true);
    expect(esCumpleanosHoy('1985-12-31', '2026-12-31')).toBe(true);
  });

  it('es false si el día o mes no coinciden', () => {
    expect(esCumpleanosHoy('1990-11-05', '2026-11-06')).toBe(false);
    expect(esCumpleanosHoy('1990-10-06', '2026-11-06')).toBe(false);
    expect(esCumpleanosHoy('1990-11-07', '2026-11-06')).toBe(false);
  });

  it('es false con valores nulos, vacíos o mal formateados', () => {
    expect(esCumpleanosHoy(null, '2026-11-06')).toBe(false);
    expect(esCumpleanosHoy('', '2026-11-06')).toBe(false);
    expect(esCumpleanosHoy('no-es-fecha', '2026-11-06')).toBe(false);
    expect(esCumpleanosHoy('1990-11-06', 'no-es-fecha')).toBe(false);
  });

  it('no acepta fechas futuras de nacimiento', () => {
    expect(esCumpleanosHoy('2030-11-06', '2026-11-06')).toBe(false);
  });

  it('celebra el 29 de febrero el 28 de febrero en años no bisiestos', () => {
    // 2026 no es bisiesto
    expect(esCumpleanosHoy('1996-02-29', '2026-02-28')).toBe(true);
    expect(esCumpleanosHoy('1996-02-29', '2026-02-27')).toBe(false);

    // 2024 fue bisiesto: el 29 de febrero se celebra el 29 de febrero
    expect(esCumpleanosHoy('1996-02-29', '2024-02-29')).toBe(true);
    expect(esCumpleanosHoy('1996-02-29', '2024-02-28')).toBe(false);
  });
});

describe('edadCumplida', () => {
  it('calcula la edad correcta al cumplir años hoy', () => {
    expect(edadCumplida('1990-11-06', '2026-11-06')).toBe(36);
    expect(edadCumplida('2000-05-20', '2026-05-20')).toBe(26);
  });

  it('devuelve null con datos inválidos', () => {
    expect(edadCumplida(null, '2026-11-06')).toBeNull();
    expect(edadCumplida('2030-11-06', '2026-11-06')).toBeNull();
  });
});

const persona = (parche: Partial<Personal>): Personal => ({
  id: 'p-' + Math.random().toString(36).slice(2, 7),
  nombre: 'Juan',
  apellido: 'Pérez',
  empresa: 'MGG',
  cargo: 'Mecánico',
  departamento: 'Mantenimiento',
  activo: true,
  sueldo_base: 0,
  fecha_nacimiento: '1992-11-06',
  ...parche,
} as Personal);

describe('obtenerCumpleaneros', () => {
  const HOY = '2026-11-06';

  it('encuentra a los trabajadores que cumplen años hoy y omite a los que no', () => {
    const lista = [
      persona({ id: '1', nombre: 'Carlos', apellido: 'Gómez', fecha_nacimiento: '1990-11-06' }),
      persona({ id: '2', nombre: 'Ana', apellido: 'Rojas', fecha_nacimiento: '1985-05-12' }),
      persona({ id: '3', nombre: 'Beatriz', apellido: 'López', fecha_nacimiento: '1998-11-06' }),
    ];

    const res = obtenerCumpleaneros(lista, HOY);
    expect(res).toHaveLength(2);
    // Ordenados alfabéticamente
    expect(res[0].nombreCompleto).toBe('Beatriz López');
    expect(res[0].edad).toBe(28);
    expect(res[1].nombreCompleto).toBe('Carlos Gómez');
    expect(res[1].edad).toBe(36);
  });

  it('omite trabajadores inactivos aunque cumplan años hoy', () => {
    const lista = [
      persona({ id: '1', nombre: 'Pedro', fecha_nacimiento: '1990-11-06', activo: false }),
      persona({ id: '2', nombre: 'María', fecha_nacimiento: '1990-11-06', activo: true }),
    ];

    const res = obtenerCumpleaneros(lista, HOY);
    expect(res).toHaveLength(1);
    expect(res[0].nombre).toBe('María');
  });

  it('permite filtrar por empresa si se requiere', () => {
    const lista = [
      persona({ id: '1', nombre: 'Luis', empresa: 'MGG', fecha_nacimiento: '1990-11-06' }),
      persona({ id: '2', nombre: 'Elena', empresa: 'GOMETAL', fecha_nacimiento: '1990-11-06' }),
    ];

    const soloMgg = obtenerCumpleaneros(lista, HOY, 'MGG');
    expect(soloMgg).toHaveLength(1);
    expect(soloMgg[0].nombre).toBe('Luis');

    const todas = obtenerCumpleaneros(lista, HOY, 'TODAS');
    expect(todas).toHaveLength(2);
  });

  it('si nadie cumple años hoy devuelve lista vacía', () => {
    const lista = [
      persona({ fecha_nacimiento: '1990-01-01' }),
      persona({ fecha_nacimiento: '1995-12-25' }),
    ];

    expect(obtenerCumpleaneros(lista, HOY)).toHaveLength(0);
  });
});

