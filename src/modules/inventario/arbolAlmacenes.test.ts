import { describe, it, expect } from 'vitest';
import { construirArbol, nombresBajoNodo } from './arbolAlmacenes';
import type { Almacen } from '@/shared/lib/types';

const alm = (id: string, nombre: string, sede: string, parent_id: string | null): Almacen =>
  ({ id, nombre, sede, parent_id, estado: 'activo', created_at: '' } as Almacen);

describe('construirArbol', () => {
  it('anida sub-almacenes bajo su padre y agrupa por sede incluida', () => {
    const data = [
      alm('1', 'Los Pinos', 'LOS PINOS', null),
      alm('2', 'Insumos', 'LOS PINOS', '1'),
      alm('3', 'Viveres', 'LOS PINOS', '1'),
      alm('9', 'Deposito', 'CENTRO DE FUNDICION - MATANZAS', null), // sede excluida
    ];
    const arbol = construirArbol(data, ['LOS PINOS']);
    expect(arbol).toHaveLength(1);
    expect(arbol[0].sede).toBe('LOS PINOS');
    expect(arbol[0].nodos).toHaveLength(1); // Los Pinos raíz
    expect(arbol[0].nodos[0].nombre).toBe('Los Pinos');
    expect(arbol[0].nodos[0].hijos.map((h) => h.nombre)).toEqual(['Insumos', 'Viveres']);
  });

  it('trata como raíz un almacén cuyo padre no pertenece a las sedes incluidas', () => {
    const data = [
      alm('10', 'Padre', 'OTRA SEDE', null),
      alm('11', 'Hijo huérfano', 'LOS PINOS', '10'), // padre fuera del set
    ];
    const arbol = construirArbol(data, ['LOS PINOS']);
    expect(arbol[0].nodos.map((n) => n.nombre)).toEqual(['Hijo huérfano']);
  });

  it('ordena sedes y nodos alfabéticamente', () => {
    const data = [
      alm('a', 'Zeta', 'PARGUAZA', null),
      alm('b', 'Alfa', 'PARGUAZA', null),
      alm('c', 'Uno', 'EL BURRO', null),
    ];
    const arbol = construirArbol(data, ['PARGUAZA', 'EL BURRO']);
    expect(arbol.map((s) => s.sede)).toEqual(['EL BURRO', 'PARGUAZA']);
    expect(arbol[1].nodos.map((n) => n.nombre)).toEqual(['Alfa', 'Zeta']);
  });
});

describe('nombresBajoNodo', () => {
  it('devuelve el nodo y todos sus descendientes', () => {
    const data = [
      alm('1', 'Los Pinos', 'LOS PINOS', null),
      alm('2', 'Insumos', 'LOS PINOS', '1'),
      alm('4', 'Sub-insumos', 'LOS PINOS', '2'),
    ];
    const arbol = construirArbol(data, ['LOS PINOS']);
    expect(nombresBajoNodo(arbol[0].nodos[0]).sort()).toEqual(['Insumos', 'Los Pinos', 'Sub-insumos']);
  });
});
