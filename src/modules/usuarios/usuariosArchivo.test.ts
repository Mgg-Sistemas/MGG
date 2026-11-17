import { describe, it, expect } from 'vitest';
import type { Usuario } from '@/shared/lib/types';
import { estaArchivado, estadoVisible, puedeArchivar, puedeRestaurar, filtrarPorEstado } from './usuariosArchivo';

const base: Usuario = {
  id: 'u1', email: 'a@gt.com', nombre: 'Ana', role: 'obrero', estado: 'activo', created_at: '2026-01-01',
};
const activo: Usuario = { ...base, id: 'activo' };
const inactivo: Usuario = { ...base, id: 'inactivo', estado: 'inactivo' };
const archivado: Usuario = { ...base, id: 'archivado', estado: 'inactivo', archivado_en: '2026-09-25T10:00:00Z' };

describe('estaArchivado', () => {
  it('es archivado solo cuando tiene fecha de archivo', () => {
    expect(estaArchivado(archivado)).toBe(true);
    expect(estaArchivado(inactivo)).toBe(false);
    expect(estaArchivado(activo)).toBe(false);
  });
  it('tolera la columna ausente (datos viejos en memoria)', () => {
    expect(estaArchivado({ ...base, archivado_en: undefined })).toBe(false);
    expect(estaArchivado({ ...base, archivado_en: null })).toBe(false);
  });
});

describe('estadoVisible', () => {
  it('el archivado se muestra como archivado, no como deshabilitado', () => {
    expect(estadoVisible(archivado)).toBe('archivado');
    expect(estadoVisible(inactivo)).toBe('inactivo');
    expect(estadoVisible(activo)).toBe('activo');
  });
});

describe('puedeArchivar / puedeRestaurar', () => {
  it('solo se archiva un usuario ya deshabilitado', () => {
    expect(puedeArchivar(inactivo)).toBe(true);
    expect(puedeArchivar(activo)).toBe(false);
    expect(puedeArchivar(archivado)).toBe(false);
  });
  it('solo se restaura un usuario archivado', () => {
    expect(puedeRestaurar(archivado)).toBe(true);
    expect(puedeRestaurar(inactivo)).toBe(false);
    expect(puedeRestaurar(activo)).toBe(false);
  });
});

describe('filtrarPorEstado', () => {
  const todos = [activo, inactivo, archivado];
  it('sin filtro, los archivados NO aparecen (es el objetivo de la funcion)', () => {
    expect(filtrarPorEstado(todos, '').map((u) => u.id)).toEqual(['activo', 'inactivo']);
  });
  it('filtro activos', () => {
    expect(filtrarPorEstado(todos, 'activo').map((u) => u.id)).toEqual(['activo']);
  });
  it('filtro deshabilitados excluye a los archivados', () => {
    expect(filtrarPorEstado(todos, 'inactivo').map((u) => u.id)).toEqual(['inactivo']);
  });
  it('filtro archivados muestra solo archivados', () => {
    expect(filtrarPorEstado(todos, 'archivado').map((u) => u.id)).toEqual(['archivado']);
  });
});
