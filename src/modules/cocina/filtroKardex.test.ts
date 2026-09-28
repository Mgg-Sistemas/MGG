import { describe, expect, it } from 'vitest';
import type { CocinaComida } from '@/shared/lib/types';
import type { KardexRow } from './mercados.repository';
import {
  diaLocal, filtrarKardex, hayFiltro, numerosDePagina, paginar, textoBuscable,
  totalesDeKardex, FILTRO_KARDEX_VACIO, POR_PAGINA, type FiltroKardex,
} from './filtroKardex';

/** Mediodía: el mismo día del calendario en cualquier huso donde corra el test. */
const alMediodia = (dia: string) => `${dia}T12:00:00.000Z`;

const entrada = (dia: string, nombre: string, extra: Partial<Record<string, unknown>> = {}): KardexRow => ({
  kind: 'entrada', at: alMediodia(dia), producto_id: `p-${nombre}`, nombre, unidad: 'KILOGRAMO',
  cantidad: 10, valor: 100, detalle: null, almacen: 'Los Pinos', ...extra,
} as KardexRow);

const merma = (dia: string, nombre: string, extra: Partial<Record<string, unknown>> = {}): KardexRow => ({
  kind: 'merma', at: alMediodia(dia), producto_id: `p-${nombre}`, nombre, unidad: 'UNIDAD',
  cantidad: 400, valor: 76, tipo: 'salida', detalle: null, almacen: 'Los Pinos', actor_name: 'ISNER', ...extra,
} as KardexRow);

const traslado = (dia: string, nombre: string, extra: Partial<Record<string, unknown>> = {}): KardexRow => ({
  kind: 'traslado', id: `t-${dia}-${nombre}`, at: alMediodia(dia), producto_id: `p-${nombre}`, nombre,
  unidad: 'KILOGRAMO', cantidad: -15, valor: 30, detalle: null, almacen: 'Los Pinos',
  contraparte: 'La Esperanza', interno: false, codigo: 'TRA-2026-0010', sinLlegada: 0, ...extra,
} as KardexRow);

const comida = (dia: string, codigo: string, tipo: string, platos: number, valor: number): KardexRow => ({
  kind: 'consumo', at: alMediodia(dia), items: 3, cantidad: 12,
  comida: {
    id: codigo, codigo, tipo_comida: tipo, platos, valor_total: valor,
    items: [{ producto_id: 'p-arroz', nombre: 'ARROZ', cantidad: 4 }],
    at: alMediodia(dia), nota: null, actor_name: 'KELVIN',
  } as unknown as CocinaComida,
} as KardexRow);

const etiqueta = (t: string) => (t === 'desayuno' ? 'Desayuno' : t === 'almuerzo' ? 'Almuerzo' : t);

const filtro = (p: Partial<FiltroKardex> = {}): FiltroKardex => ({ ...FILTRO_KARDEX_VACIO, ...p });

const FILAS: KardexRow[] = [
  merma('2026-09-26', 'SALCHICHAS DE POLLO'),
  entrada('2026-09-25', 'CARNE GUISAR'),
  comida('2026-09-25', 'COC-2026-0393', 'desayuno', 45, 19.11),
  traslado('2026-09-24', 'ACEITE'),
  comida('2026-09-20', 'COC-2026-0380', 'almuerzo', 120, 88.4),
];

describe('hayFiltro', () => {
  it('con todo vacío, no hay filtro', () => {
    expect(hayFiltro(FILTRO_KARDEX_VACIO)).toBe(false);
  });
  it('cualquier campo puesto ya es un filtro', () => {
    expect(hayFiltro(filtro({ desde: '2026-09-01' }))).toBe(true);
    expect(hayFiltro(filtro({ clase: 'merma' }))).toBe(true);
    expect(hayFiltro(filtro({ tipoComida: 'desayuno' }))).toBe(true);
    expect(hayFiltro(filtro({ texto: '  ' }))).toBe(false);
    expect(hayFiltro(filtro({ texto: 'pollo' }))).toBe(true);
  });
});

describe('diaLocal', () => {
  it('lee el día en hora local, no el prefijo del ISO', () => {
    // 21:00 en Caracas del 26 son las 01:00 UTC del 27: la fila dice 26 y el
    // filtro tiene que decir lo mismo.
    const iso = '2026-09-26T21:00:00-04:00';
    const esperado = new Date(iso).getDate();
    expect(Number(diaLocal(iso).slice(-2))).toBe(esperado);
  });
  it('una fecha inválida devuelve vacío en vez de romper', () => {
    expect(diaLocal('no es fecha')).toBe('');
  });
});

describe('filtrarKardex', () => {
  it('sin filtro devuelve todo, en el mismo orden', () => {
    expect(filtrarKardex(FILAS, FILTRO_KARDEX_VACIO)).toEqual(FILAS);
  });

  it('recorta por clase de movimiento', () => {
    expect(filtrarKardex(FILAS, filtro({ clase: 'merma' })).length).toBe(1);
    expect(filtrarKardex(FILAS, filtro({ clase: 'consumo' })).length).toBe(2);
    expect(filtrarKardex(FILAS, filtro({ clase: 'traslado' })).length).toBe(1);
  });

  it('recorta por rango de fechas, con los dos extremos adentro', () => {
    expect(filtrarKardex(FILAS, filtro({ desde: '2026-09-25' })).length).toBe(3);
    expect(filtrarKardex(FILAS, filtro({ hasta: '2026-09-24' })).length).toBe(2);
    expect(filtrarKardex(FILAS, filtro({ desde: '2026-09-25', hasta: '2026-09-25' })).length).toBe(2);
  });

  it('el tipo de comida deja solo consumos de ese tipo', () => {
    const r = filtrarKardex(FILAS, filtro({ tipoComida: 'desayuno' }));
    expect(r.length).toBe(1);
    expect(r[0].kind).toBe('consumo');
  });

  it('busca por víver, por almacén, por quién lo hizo y por código de traslado', () => {
    expect(filtrarKardex(FILAS, filtro({ texto: 'salchichas' })).length).toBe(1);
    expect(filtrarKardex(FILAS, filtro({ texto: 'isner' })).length).toBe(1);
    expect(filtrarKardex(FILAS, filtro({ texto: 'TRA-2026-0010' })).length).toBe(1);
    expect(filtrarKardex(FILAS, filtro({ texto: 'los pinos' })).length).toBe(3);
  });

  it('busca por fecha tecleada de las tres formas', () => {
    for (const q of ['26/09/2026', '26-09-2026', '2026-09-26']) {
      expect(filtrarKardex(FILAS, filtro({ texto: q })).length).toBe(1);
    }
  });

  it('exige TODAS las palabras, no cualquiera', () => {
    expect(filtrarKardex(FILAS, filtro({ texto: 'salchichas 25/09/2026' })).length).toBe(0);
    expect(filtrarKardex(FILAS, filtro({ texto: 'carne 25/09/2026' })).length).toBe(1);
  });

  it('ignora tildes y mayúsculas', () => {
    const r = filtrarKardex(FILAS, filtro({ texto: 'DESAYÚNO' }), etiqueta);
    expect(r.length).toBe(1);
  });

  it('combina fecha y clase', () => {
    expect(filtrarKardex(FILAS, filtro({ clase: 'consumo', desde: '2026-09-25' })).length).toBe(1);
  });
});

describe('textoBuscable', () => {
  it('de un consumo trae el código, el tipo, la nota y los víveres', () => {
    const t = textoBuscable(comida('2026-09-25', 'COC-2026-0393', 'desayuno', 45, 19.11), etiqueta);
    expect(t).toContain('coc-2026-0393');
    expect(t).toContain('desayuno');
    expect(t).toContain('arroz');
    expect(t).toContain('45');
  });
  it('de un traslado trae la contraparte y avisa si no llegó', () => {
    const t = textoBuscable(traslado('2026-09-24', 'ACEITE', { sinLlegada: 15 }), etiqueta);
    expect(t).toContain('la esperanza');
    expect(t).toContain('sin llegada');
  });
});

describe('totalesDeKardex', () => {
  it('suma platos, consumo, entradas y mermas de lo que está a la vista', () => {
    const t = totalesDeKardex(FILAS);
    expect(t.movimientos).toBe(5);
    expect(t.comidas).toBe(2);
    expect(t.platos).toBe(165);
    expect(t.consumoValor).toBe(107.51);
    expect(t.entradasValor).toBe(100);
    expect(t.mermasValor).toBe(76);
    expect(t.porPlato).toBe(0.65);
  });

  it('sin platos, el promedio es null y no cero', () => {
    expect(totalesDeKardex([entrada('2026-09-25', 'CARNE')]).porPlato).toBeNull();
    expect(totalesDeKardex([]).porPlato).toBeNull();
  });

  it('cuenta víveres distintos, sin repetir', () => {
    expect(totalesDeKardex([entrada('2026-09-25', 'A'), entrada('2026-09-26', 'A')]).viveres).toBe(1);
  });

  it('los totales siguen al filtro: son de lo que se está viendo', () => {
    const soloComidas = filtrarKardex(FILAS, filtro({ clase: 'consumo' }));
    expect(totalesDeKardex(soloComidas).entradasValor).toBe(0);
    expect(totalesDeKardex(soloComidas).platos).toBe(165);
  });
});

describe('paginar', () => {
  const n = Array.from({ length: 23 }, (_, i) => i + 1);

  it('corta de a diez', () => {
    expect(POR_PAGINA).toBe(10);
    const p = paginar(n, 1);
    expect(p.items).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(p.paginas).toBe(3);
    expect(p.primero).toBe(1);
    expect(p.ultimo).toBe(10);
    expect(p.total).toBe(23);
  });

  it('la última página trae lo que sobra', () => {
    const p = paginar(n, 3);
    expect(p.items).toEqual([21, 22, 23]);
    expect(p.primero).toBe(21);
    expect(p.ultimo).toBe(23);
  });

  it('una página que ya no existe cae en la última, no en el vacío', () => {
    expect(paginar(n, 9).pagina).toBe(3);
    expect(paginar(n, 0).pagina).toBe(1);
    expect(paginar(n, -4).pagina).toBe(1);
  });

  it('sin filas, una página vacía y sin numeritos raros', () => {
    const p = paginar([], 1);
    expect(p.items).toEqual([]);
    expect(p.paginas).toBe(1);
    expect(p.primero).toBe(0);
    expect(p.ultimo).toBe(0);
  });
});

describe('numerosDePagina', () => {
  it('con pocas páginas las muestra todas', () => {
    expect(numerosDePagina(1, 1)).toEqual([1]);
    expect(numerosDePagina(2, 4)).toEqual([1, 2, 3, 4]);
  });

  it('con muchas, deja la primera, la última y las vecinas', () => {
    expect(numerosDePagina(8, 18)).toEqual([1, '…', 7, 8, 9, '…', 18]);
    expect(numerosDePagina(1, 18)).toEqual([1, 2, '…', 18]);
    expect(numerosDePagina(18, 18)).toEqual([1, '…', 17, 18]);
  });

  it('un hueco de una sola página se dibuja, no se tapa con «…»', () => {
    expect(numerosDePagina(3, 5)).toEqual([1, 2, 3, 4, 5]);
  });
});
