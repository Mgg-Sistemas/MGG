import { describe, expect, it } from 'vitest';
import { aplicarFiltros, buscaEn, conteoOpcion, numerosPagina, paginar, type FiltroLista } from './listas';

describe('paginador numerado', () => {
  it('pocas páginas: todas, sin huecos', () => {
    expect(numerosPagina(1, 4)).toEqual([1, 2, 3, 4]);
  });

  it('en medio: el primero, los vecinos y el último, con «…» en los huecos', () => {
    expect(numerosPagina(10, 20)).toEqual([1, '…', 9, 10, 11, '…', 20]);
  });

  it('al principio y al final muestra un tramo más largo', () => {
    expect(numerosPagina(2, 20)).toEqual([1, 2, 3, 4, '…', 20]);
    expect(numerosPagina(19, 20)).toEqual([1, '…', 17, 18, 19, 20]);
  });

  it('una sola página', () => {
    expect(numerosPagina(1, 1)).toEqual([1]);
  });
});

describe('paginar', () => {
  const xs = Array.from({ length: 60 }, (_, i) => i + 1);

  it('dice desde, hasta y cuántas páginas hay', () => {
    expect(paginar(xs, 2, 25)).toMatchObject({ pag: 2, paginas: 3, desde: 26, hasta: 50, total: 60 });
    expect(paginar(xs, 3, 25).filas).toHaveLength(10);
  });

  it('una página fuera de rango se ajusta (por ejemplo, después de filtrar)', () => {
    expect(paginar(xs, 9, 25).pag).toBe(3);
    expect(paginar(xs, 0, 25).pag).toBe(1);
  });

  it('sin filas: página 1 de 1, de 0 a 0', () => {
    expect(paginar([], 4, 25)).toMatchObject({ pag: 1, paginas: 1, desde: 0, hasta: 0, total: 0 });
  });
});

describe('buscar y filtrar', () => {
  it('busca sin tildes ni mayúsculas, en cualquiera de los campos', () => {
    expect(buscaEn('compania', 'Compañía de Prueba')).toBe(true);
    expect(buscaEn('PRUEBA', null, 'Compañía de prueba')).toBe(true);
    expect(buscaEn('otra', 'Compañía de prueba')).toBe(false);
    expect(buscaEn('', 'cualquier cosa')).toBe(true);
  });

  type Fila = { tipo: string; estado: string };
  const base: Fila[] = [
    { tipo: 'iva', estado: 'registrada' }, { tipo: 'iva', estado: 'declarada' },
    { tipo: 'islr', estado: 'registrada' }, { tipo: 'islr', estado: 'registrada' },
  ];
  const filtros = (tipo: string, estado: string): FiltroLista<Fila>[] => [
    { campo: 'tipo', etiqueta: 'Impuesto', valor: tipo, opciones: [], pasa: (x, v) => x.tipo === v },
    { campo: 'estado', etiqueta: 'Estado', valor: estado, opciones: [], pasa: (x, v) => x.estado === v },
  ];

  it('el conteo de cada opción respeta los demás filtros, no el propio', () => {
    const fs = filtros('iva', 'registrada');
    expect(conteoOpcion(base, fs, 'tipo', 'islr')).toBe(2);       // islr y registrada
    expect(conteoOpcion(base, fs, 'estado', 'declarada')).toBe(1); // iva y declarada
  });

  it('aplica todos los filtros puestos; uno vacío no filtra', () => {
    expect(aplicarFiltros(base, filtros('iva', ''))).toHaveLength(2);
    expect(aplicarFiltros(base, filtros('islr', 'registrada'))).toHaveLength(2);
    expect(aplicarFiltros(base, filtros('', ''))).toHaveLength(4);
  });
});
