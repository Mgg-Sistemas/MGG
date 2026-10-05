import { describe, expect, it } from 'vitest';
import type { Personal } from '@/shared/lib/types';
import { CAMPOS_EXPORT, CAMPOS_POR_DEFECTO, camposElegidos, fechaCorta, tablaExport } from './exportarPersonal';

const p = (x: Partial<Personal>): Personal => ({
  id: 'x', nombre: 'LENISKA', apellido: 'PÉREZ', sueldo_base: 800, activo: true, created_at: '2026-01-01', ...x,
}) as Personal;

describe('exportar datos del personal', () => {
  it('por defecto sale nombre y cédula, con el N° de renglón', () => {
    const { head, filas } = tablaExport([p({ cedula: 'V-12345678' }), p({ nombre: 'ANA', apellido: 'GIL', cedula: 'V-9' })], CAMPOS_POR_DEFECTO);
    expect(head).toEqual(['#', 'Nombre y apellido', 'Cédula']);
    expect(filas).toEqual([[1, 'LENISKA PÉREZ', 'V-12345678'], [2, 'ANA GIL', 'V-9']]);
  });
  it('las columnas salen en el orden de la lista, no en el que se marcaron', () => {
    expect(camposElegidos(['cedula', 'numero_ficha']).map((c) => c.key)).toEqual(['numero_ficha', 'cedula']);
  });
  it('vacíos quedan en blanco, nunca «null»', () => {
    const { filas } = tablaExport([p({ cedula: null, telefono: undefined })], ['cedula', 'telefono', 'fecha_ingreso']);
    expect(filas[0]).toEqual([1, '', '', '']);
  });
  it('fechas en dd/mm/aaaa sin correrse un día', () => {
    expect(fechaCorta('2026-10-05')).toBe('05/10/2026');
    expect(fechaCorta(null)).toBe('');
  });
  it('estado, sueldo y salud se leen en español', () => {
    const { filas } = tablaExport([p({ activo: false, tiene_alergias: true, alergias_detalle: 'Penicilina', tiene_enfermedad: false })],
      ['estado', 'sueldo_base', 'alergias', 'enfermedad']);
    expect(filas[0]).toEqual([1, 'Inactivo', 800, 'Sí: Penicilina', 'No']);
  });
  it('no hay dos campos con la misma clave', () => {
    expect(new Set(CAMPOS_EXPORT.map((c) => c.key)).size).toBe(CAMPOS_EXPORT.length);
  });
});
