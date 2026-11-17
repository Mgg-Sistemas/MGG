import { describe, it, expect } from 'vitest';
import { crearRepoDemo } from './demo/datosDemoAdministracion';
import { arbolCarpetas } from './administracionCarpetas';

describe('AdminRepo · carpetas (anidables, en la base)', () => {
  it('CRUD de carpetas por empresa', async () => {
    const repo = crearRepoDemo();
    const raiz = await repo.crearCarpeta({ empresaClave: 'GT', nombre: 'Legal', parentId: null, orden: 1 });
    await repo.crearCarpeta({ empresaClave: 'GT', nombre: 'Poderes', parentId: raiz.id, orden: 1 });
    expect(await repo.listCarpetas('GT')).toHaveLength(2);

    await repo.editarCarpeta(raiz.id, { nombre: 'Legal y constitutivo' });
    expect((await repo.listCarpetas('GT')).find((c) => c.id === raiz.id)?.nombre).toBe('Legal y constitutivo');

    await repo.borrarCarpeta(raiz.id);
    expect((await repo.listCarpetas('GT')).some((c) => c.id === raiz.id)).toBe(false);
  });
});

describe('arbolCarpetas', () => {
  it('anida por parentId; las sin parent quedan en raíz, ordenadas', () => {
    const cs = [
      { id: 'a', empresaClave: 'GT', nombre: 'Raíz', parentId: null, orden: 1 },
      { id: 'b', empresaClave: 'GT', nombre: 'Hija', parentId: 'a', orden: 1 },
      { id: 'c', empresaClave: 'GT', nombre: 'Otra raíz', parentId: null, orden: 2 },
    ];
    const arbol = arbolCarpetas(cs);
    expect(arbol.map((n) => n.id)).toEqual(['a', 'c']);
    expect(arbol[0].hijos.map((n) => n.id)).toEqual(['b']);
    expect(arbol[1].hijos).toEqual([]);
  });
});
