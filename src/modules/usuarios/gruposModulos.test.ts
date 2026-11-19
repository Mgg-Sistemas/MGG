import { describe, expect, it } from 'vitest';
import { MODULES, type RolePermisos } from './permisos.repository';
import { GRUPOS_MODULOS, alcanceDeGrupo, alcanceDeRol, gruposConTodos } from './gruposModulos';

/* La matriz agrupa los módulos para que se lea por proceso. Si un módulo
   se cayera de la agrupación, su permiso quedaría invisible y nadie podría
   asignarlo: eso es lo que vigilan estas pruebas. */
describe('agrupación de módulos de la matriz', () => {
  const agrupados = GRUPOS_MODULOS.flatMap((g) => g.modulos);

  it('no deja ningún módulo fuera', () => {
    const faltantes = MODULES.map((m) => m.key).filter((k) => !agrupados.includes(k));
    expect(faltantes).toEqual([]);
  });

  it('no repite ningún módulo en dos grupos', () => {
    expect(agrupados).toHaveLength(new Set(agrupados).size);
  });

  it('cubre exactamente los módulos que existen', () => {
    expect(agrupados).toHaveLength(MODULES.length);
  });

  it('un módulo nuevo sin agrupar cae en «Otros módulos», no desaparece', () => {
    const total = gruposConTodos().flatMap((g) => g.modulos);
    expect(total).toHaveLength(MODULES.length);
  });
});

describe('alcance de un rol', () => {
  const permisos = {
    dashboard: { lectura: true, escritura: false, full: false },
    tesoreria: { lectura: true, escritura: true, full: false },
    usuarios: { lectura: true, escritura: true, full: true },
    inventario: { lectura: false, escritura: false, full: false },
  } as unknown as RolePermisos;

  it('cuenta como accesibles los módulos con lectura o full', () => {
    const a = alcanceDeRol(permisos);
    expect(a.conAcceso).toBe(3);
    expect(a.escritura).toBe(2);
    expect(a.full).toBe(1);
    expect(a.total).toBe(MODULES.length);
  });

  it('no cuenta un módulo sin ningún permiso', () => {
    expect(alcanceDeGrupo(permisos, ['inventario'])).toBe(0);
  });

  it('resume por grupo lo que el encabezado plegado muestra', () => {
    expect(alcanceDeGrupo(permisos, ['dashboard', 'usuarios', 'ajustes'])).toBe(2);
  });

  it('un rol sin fila guardada no tiene acceso a nada', () => {
    expect(alcanceDeRol(undefined).conAcceso).toBe(0);
  });
});
