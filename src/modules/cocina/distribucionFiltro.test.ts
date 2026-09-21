import { describe, expect, it } from 'vitest';
import { coincideSeleccion, etiquetaSeleccion, filtrarDistribucion, ordenarDistribucion } from './distribucionFiltro';
import type { ResumenDistribucion } from './distribucionEoq';

const viver = (over: Partial<ResumenDistribucion>): ResumenDistribucion => ({
  producto_id: 'p', sku: 'VIV-000', nombre: 'VÍVER', unidad: 'UNIDAD',
  stock: 0, consumoTotal: 0, diasConConsumo: 0, promedioDia: 0, comensales: 0,
  ratioPromedio: 0, mermas: 0, demandaAnual: 0, eoq: 0, puntoReorden: 0,
  cicloDias: 0, frecuenciaAnual: 0, estado: 'NORMAL', filas: [], ...over,
});

const harina = viver({ producto_id: '1', sku: 'VIV-087', nombre: 'HARINA DE MAIZ 1KG', estado: 'REORDENAR', consumoTotal: 37 });
const pollo = viver({ producto_id: '2', sku: 'POT-001', nombre: 'POLLO FRESCO', estado: 'NORMAL', consumoTotal: 100, mermas: 450.3 });
const arroz = viver({ producto_id: '3', sku: 'VIV-057', nombre: 'ARROZ MARY', estado: 'ALERTA', consumoTotal: 18 });
const sal = viver({ producto_id: '4', sku: 'VIV-999', nombre: 'SAL', estado: 'NORMAL' });
const todos = [sal, pollo, arroz, harina];

describe('coincideSeleccion', () => {
  it('«Por reponer» deja solo los que están en el punto de reorden', () => {
    expect(coincideSeleccion(harina, 'reponer')).toBe(true);
    expect(coincideSeleccion(arroz, 'reponer')).toBe(false);
  });

  it('«En alerta» deja solo los que están por caer', () => {
    expect(coincideSeleccion(arroz, 'alerta')).toBe(true);
    expect(coincideSeleccion(harina, 'alerta')).toBe(false);
  });

  it('«Consumido» deja los que se movieron, no los quietos', () => {
    expect(coincideSeleccion(pollo, 'consumido')).toBe(true);
    expect(coincideSeleccion(sal, 'consumido')).toBe(false);
  });

  it('«Mermas» deja solo los que tuvieron pérdidas', () => {
    expect(coincideSeleccion(pollo, 'mermas')).toBe(true);
    expect(coincideSeleccion(harina, 'mermas')).toBe(false);
  });

  it('«Víveres» no filtra nada', () => {
    for (const v of todos) expect(coincideSeleccion(v, 'todos')).toBe(true);
  });
});

describe('ordenarDistribucion', () => {
  it('primero lo urgente, después lo que más se consume', () => {
    expect(ordenarDistribucion(todos).map((i) => i.nombre)).toEqual([
      'HARINA DE MAIZ 1KG', 'ARROZ MARY', 'POLLO FRESCO', 'SAL',
    ]);
  });

  it('no toca el arreglo original', () => {
    const copia = [...todos];
    ordenarDistribucion(todos);
    expect(todos).toEqual(copia);
  });
});

describe('filtrarDistribucion', () => {
  it('sin filtros devuelve todo, ordenado', () => {
    expect(filtrarDistribucion(todos)).toHaveLength(4);
  });

  it('la tarjeta tocada recorta la tabla', () => {
    expect(filtrarDistribucion(todos, { seleccion: 'reponer' }).map((i) => i.sku)).toEqual(['VIV-087']);
    expect(filtrarDistribucion(todos, { seleccion: 'mermas' }).map((i) => i.sku)).toEqual(['POT-001']);
  });

  it('el buscador se suma a la tarjeta', () => {
    expect(filtrarDistribucion(todos, { seleccion: 'consumido', q: 'arroz' }).map((i) => i.sku)).toEqual(['VIV-057']);
    expect(filtrarDistribucion(todos, { seleccion: 'reponer', q: 'arroz' })).toEqual([]);
  });

  it('busca por SKU además de por nombre', () => {
    expect(filtrarDistribucion(todos, { q: 'viv-087' }).map((i) => i.nombre)).toEqual(['HARINA DE MAIZ 1KG']);
  });

  it('la casilla «solo los que hay que reponer» deja reordenar y alerta', () => {
    expect(filtrarDistribucion(todos, { soloReponer: true }).map((i) => i.sku)).toEqual(['VIV-087', 'VIV-057']);
  });
});

describe('etiquetaSeleccion', () => {
  it('cada tarjeta se nombra para poder mostrarlo arriba de la tabla', () => {
    expect(etiquetaSeleccion('todos')).toBe('Todos los víveres');
    expect(etiquetaSeleccion('reponer')).toBe('Por reponer');
    expect(etiquetaSeleccion('alerta')).toBe('En alerta');
    expect(etiquetaSeleccion('consumido')).toContain('consumo');
    expect(etiquetaSeleccion('mermas')).toContain('mermas');
  });
});
