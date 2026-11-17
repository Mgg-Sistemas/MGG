import { describe, it, expect } from 'vitest';
import { estadoInicialSecciones } from './SeccionColapsable';

describe('estadoInicialSecciones', () => {
  it('deja cerradas las secciones indicadas y abiertas las demás', () => {
    const e = estadoInicialSecciones(['empresas', 'categorias', 'carpetas'], {
      cerradasPorDefecto: ['categorias'],
    });
    expect(e).toEqual({ empresas: true, categorias: false, carpetas: true });
  });

  it('sin cerradasPorDefecto, todas arrancan abiertas', () => {
    expect(estadoInicialSecciones(['a', 'b'])).toEqual({ a: true, b: true });
  });

  it('ignora claves de cerradasPorDefecto que no están en la lista', () => {
    expect(estadoInicialSecciones(['a'], { cerradasPorDefecto: ['categorias'] })).toEqual({ a: true });
  });
});
