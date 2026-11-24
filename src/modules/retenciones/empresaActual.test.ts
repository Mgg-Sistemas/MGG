import { describe, it, expect } from 'vitest';
import { empresaPorDefecto, esEmpresaGt } from './empresaActual';
import type { EmpresaReceptora } from './empresasReceptoras.repository';

/** Fábrica mínima: solo los campos que mira empresaPorDefecto / esEmpresaGt. */
function emp(over: Partial<EmpresaReceptora> & { id: string }): EmpresaReceptora {
  return {
    clave: over.clave ?? over.id, nombre: over.id, rif: 'J-0', colorBadge: '#000',
    activo: true, orden: 1, ...over,
  } as EmpresaReceptora;
}

// GT REAL: su id es 'empresa-golden-touch' pero su clave es 'golden_touch' (distinta).
const GT = emp({ id: 'empresa-golden-touch', clave: 'golden_touch', nombre: 'Golden Touch' });

describe('esEmpresaGt · detecta a GT por ID, no por clave (B1)', () => {
  it('GT real (id=empresa-golden-touch, clave=golden_touch) es GT', () => {
    expect(esEmpresaGt(GT)).toBe(true);
  });

  it('una NO-GT no es GT aunque su clave se parezca', () => {
    expect(esEmpresaGt(emp({ id: 'empresa-mto', clave: 'empresa-golden-touch' }))).toBe(false);
    expect(esEmpresaGt(emp({ id: 'empresa-mto', clave: 'mto' }))).toBe(false);
  });

  it('null/undefined no es GT', () => {
    expect(esEmpresaGt(null)).toBe(false);
    expect(esEmpresaGt(undefined)).toBe(false);
  });
});

describe('empresaPorDefecto', () => {
  it('null si no hay empresas', () => {
    expect(empresaPorDefecto([], 'x')).toBeNull();
  });

  it('respeta la guardada si sigue activa', () => {
    const lista = [GT, emp({ id: 'b' })];
    expect(empresaPorDefecto(lista, 'b')).toBe('b');
  });

  it('ignora la guardada si ya no existe y cae en GT (por id)', () => {
    const lista = [emp({ id: 'a' }), GT];
    expect(empresaPorDefecto(lista, 'zzz')).toBe('empresa-golden-touch');
  });

  it('ignora la guardada si está inactiva', () => {
    const lista = [emp({ id: 'a' }), emp({ id: 'b', activo: false })];
    expect(empresaPorDefecto(lista, 'b')).toBe('a');
  });

  it('sin guardada ni GT, toma la primera activa (ya vienen ordenadas)', () => {
    const lista = [emp({ id: 'uno' }), emp({ id: 'dos' })];
    expect(empresaPorDefecto(lista, null)).toBe('uno');
  });

  it('prefiere GT (por id) sobre la primera cuando no hay guardada', () => {
    const lista = [emp({ id: 'mto' }), GT];
    expect(empresaPorDefecto(lista, null)).toBe('empresa-golden-touch');
  });

  it('si todas están inactivas, igual elige una (no deja al módulo sin empresa)', () => {
    const lista = [emp({ id: 'a', activo: false }), emp({ id: 'b', activo: false })];
    expect(empresaPorDefecto(lista, null)).toBe('a');
  });
});
