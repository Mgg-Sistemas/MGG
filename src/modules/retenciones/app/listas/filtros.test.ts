import { describe, expect, it } from 'vitest';
import {
  aplicarFiltros, buscaEn, chipsActivos, contarOpcion, estadoInicialLista, normalizarLista, opcionesConConteo,
  reducirLista, textoOpcion, textoResultados, textoResumenFiltros, textoTodos, type FiltroLista, type PasaFiltro,
} from './filtros';

// Datos inventados: solo para las pruebas.
interface Fila { id: number; k: 'iva' | 'islr' | 'isae'; mes: string; prov: string; rif: string; comp: string }
const FILAS: Fila[] = [
  { id: 1, k: 'iva', mes: '2026-09', prov: 'Proveedor de ejemplo Uno', rif: 'J-00000001-0', comp: '20260900000001' },
  { id: 2, k: 'iva', mes: '2026-10', prov: 'Proveedor de ejemplo Dos', rif: 'J-00000002-0', comp: '20261000000002' },
  { id: 3, k: 'islr', mes: '2026-10', prov: 'Proveedor de ejemplo Uno', rif: 'J-00000001-0', comp: '0000000003' },
  { id: 4, k: 'isae', mes: '2026-10', prov: 'Compañía de ejemplo', rif: 'V-00000004-0', comp: '0000000004' },
  { id: 5, k: 'isae', mes: '2026-09', prov: 'Proveedor de ejemplo Dos', rif: 'J-00000002-0', comp: '0000000005' },
];
const pasa: PasaFiltro<Fila> = (x, campo, v) => (campo === 'k' ? x.k === v : campo === 'mes' ? x.mes === v : true);

describe('la búsqueda de las listas (R3-11)', () => {
  it('no distingue acentos, mayúsculas, guiones ni espacios', () => {
    expect(normalizarLista('Compañía  J-00000001-0')).toBe('companiaj000000010');
    expect(buscaEn('compania', 'Compañía de ejemplo')).toBe(true);
    expect(buscaEn('j00000002', 'J-00000002-0')).toBe(true);
    expect(buscaEn('J-0000000', 'V-00000004-0')).toBe(false);
  });

  it('busca en cualquiera de los campos; sin búsqueda, todo pasa', () => {
    expect(buscaEn('202610', 'OC-0001', '20261000000002')).toBe(true);
    expect(buscaEn('', 'cualquier cosa')).toBe(true);
    expect(buscaEn(null, null)).toBe(true);
    expect(buscaEn('x', null, undefined)).toBe(false);
  });
});

describe('los filtros con su conteo (R3-11)', () => {
  it('filtra con todos los filtros puestos; el vacío es «Todos»', () => {
    expect(aplicarFiltros(FILAS, [{ campo: 'k', valor: 'iva' }, { campo: 'mes', valor: '' }], pasa).map((x) => x.id)).toEqual([1, 2]);
    expect(aplicarFiltros(FILAS, [{ campo: 'k', valor: 'isae' }, { campo: 'mes', valor: '2026-10' }], pasa).map((x) => x.id)).toEqual([4]);
    expect(aplicarFiltros(FILAS, [], pasa)).toHaveLength(5);
  });

  it('cada opción cuenta con los DEMÁS filtros puestos, no con el suyo', () => {
    const filtros = [{ campo: 'k', valor: 'iva' }, { campo: 'mes', valor: '2026-10' }];
    // Impuesto: se reemplaza el propio (iva) por cada opción, con el mes puesto
    expect(contarOpcion(FILAS, filtros, 'k', 'iva', pasa)).toBe(1);
    expect(contarOpcion(FILAS, filtros, 'k', 'islr', pasa)).toBe(1);
    expect(contarOpcion(FILAS, filtros, 'k', 'isae', pasa)).toBe(1);
    // Mes: con el impuesto IVA puesto
    expect(contarOpcion(FILAS, filtros, 'mes', '2026-09', pasa)).toBe(1);
    expect(contarOpcion(FILAS, filtros, 'mes', '2026-10', pasa)).toBe(1);
  });

  it('arma las opciones con su conteo y, si se pide, quita las vacías salvo la elegida', () => {
    const filtros = [{ campo: 'k', valor: 'islr' }, { campo: 'mes', valor: '2026-09' }];
    const ops = opcionesConConteo(FILAS, filtros, 'k', [['iva', 'IVA'], ['islr', 'ISLR'], ['isae', 'ISAE']], pasa);
    expect(ops).toEqual([{ valor: 'iva', texto: 'IVA', cuenta: 1 }, { valor: 'islr', texto: 'ISLR', cuenta: 0 }, { valor: 'isae', texto: 'ISAE', cuenta: 1 }]);
    const sinVacias = opcionesConConteo(FILAS, [{ campo: 'k', valor: '' }, { campo: 'mes', valor: '2026-09' }], 'k', [['iva', 'IVA'], ['islr', 'ISLR'], ['isae', 'ISAE']], pasa, true);
    expect(sinVacias.map((o) => o.valor)).toEqual(['iva', 'isae']);
    const conElegida = opcionesConConteo(FILAS, filtros, 'k', [['iva', 'IVA'], ['islr', 'ISLR'], ['isae', 'ISAE']], pasa, true);
    expect(conElegida.map((o) => o.valor)).toEqual(['iva', 'islr', 'isae']);
  });

  it('los textos de la barra: resultados, «Todos (N)», la opción con su conteo y «Filtros (N)»', () => {
    expect(textoResultados(3730)).toBe('3.730 resultado(s)');
    expect(textoTodos()).toBe('Todos');
    expect(textoTodos(12)).toBe('Todos (12)');
    expect(textoOpcion({ valor: 'iva', texto: 'IVA', cuenta: 1200 })).toBe('IVA (1.200)');
    expect(textoOpcion({ valor: 'iva', texto: 'IVA' })).toBe('IVA');
    expect(textoResumenFiltros(0)).toBe('Filtros');
    expect(textoResumenFiltros(2)).toBe('Filtros (2)');
  });

  it('los filtros activos quedan a la vista como chips, con el texto de la opción', () => {
    const filtros: FiltroLista[] = [
      { campo: 'k', etiqueta: 'Impuesto', valor: 'iva', opciones: [{ valor: 'iva', texto: 'IVA', cuenta: 2 }] },
      { campo: 'mes', etiqueta: 'Mes', valor: '', opciones: [] },
      { campo: 'origen', etiqueta: 'Origen', valor: 'otro', opciones: [] },
    ];
    expect(chipsActivos('uno', filtros)).toEqual(['Búsqueda: «uno»', 'Impuesto: IVA', 'Origen: otro']);
    expect(chipsActivos('', filtros.slice(1, 2))).toEqual([]);
  });
});

describe('el estado de una lista: al cambiar un filtro, página 1', () => {
  const base = { ...estadoInicialLista({ k: '', mes: '' }, 'reciente'), pagina: 14 };

  it('buscar, filtrar y ordenar vuelven a la página 1', () => {
    expect(reducirLista(base, { tipo: 'buscar', q: 'uno' })).toMatchObject({ q: 'uno', pagina: 1 });
    expect(reducirLista(base, { tipo: 'filtrar', campo: 'k', valor: 'iva' })).toMatchObject({ filtros: { k: 'iva', mes: '' }, pagina: 1 });
    expect(reducirLista(base, { tipo: 'ordenar', orden: 'antiguo' })).toMatchObject({ orden: 'antiguo', pagina: 1 });
  });

  it('la misma búsqueda no mueve la página', () => {
    expect(reducirLista(base, { tipo: 'buscar', q: '' })).toBe(base);
  });

  it('cambiar de página no toca lo demás', () => {
    expect(reducirLista(base, { tipo: 'pagina', pagina: 3 })).toEqual({ ...base, pagina: 3 });
    expect(reducirLista(base, { tipo: 'pagina', pagina: 0 }).pagina).toBe(1);
  });

  it('«Quitar filtros» borra la búsqueda y los filtros, conserva el orden y vuelve a la página 1', () => {
    const lleno = { q: 'uno', filtros: { k: 'iva', mes: '2026-10' }, orden: 'proveedor', pagina: 5 };
    expect(reducirLista(lleno, { tipo: 'quitar' })).toEqual({ q: '', filtros: { k: '', mes: '' }, orden: 'proveedor', pagina: 1 });
  });
});
