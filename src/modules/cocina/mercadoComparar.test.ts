import { describe, it, expect } from 'vitest';
import {
  compararConsumos, describirEvento, diferenciasPorViver, productosAjustados,
  separarMovidos, totalesDeMercado,
} from './mercadoComparar';
import type { DisponibleItem, EventoMercado, ItemAgg } from './mercados.repository';

// Víveres reales de La Esperanza, con los números que muestra la pantalla hoy.
const d = (
  producto_id: string, nombre: string, unidad: string,
  saldoInicial: number, entradas: number, consumos: number,
): DisponibleItem => ({
  producto_id, sku: producto_id, nombre, unidad, precio: 1,
  saldoInicial, entradas, consumos,
  disponible: Math.round((saldoInicial + entradas) * 100) / 100,
  queda: Math.round((saldoInicial + entradas - consumos) * 100) / 100,
});

const MERCADO: DisponibleItem[] = [
  d('p1', 'ARROZ MARY ESMERALDA 900GR', 'UNIDAD', 0, 125.5, 4.5),   // queda 121
  d('p2', 'ATUN DELMARE 140GR ACEITE', 'UNIDAD', 0, 80, 7),          // queda 73
  d('p3', 'AVENA QUACKER 800GR', 'KILOGRAMO', 0, 1.4, 0),            // queda 1,4
  d('p4', 'AZUCAR KONFIT 1KG', 'KILOGRAMO', 0.35, 20, 0.7),          // queda 19,65
  d('p5', 'BAYGON', 'UNIDAD', 3, 0, 0),                              // queda 3 · no se movió
  d('p6', 'BERENJENA', 'KILOGRAMO', 2, 0, 0),                        // queda 2 · no se movió
];

describe('diferenciasPorViver', () => {
  it('cuando el inventario coincide con el libro, no hay nada que mostrar', () => {
    const stock = new Map(MERCADO.map((x) => [x.producto_id, x.queda] as const));
    expect(diferenciasPorViver(MERCADO, stock)).toEqual([]);
  });

  it('detecta el faltante y el sobrante, y ordena por el descuadre más grande', () => {
    const stock = new Map(MERCADO.map((x) => [x.producto_id, x.queda] as const));
    stock.set('p1', 117);      // faltan 4 arroces
    stock.set('p4', 49.65);    // sobran 30 kg de azúcar
    const difs = diferenciasPorViver(MERCADO, stock);
    expect(difs.map((x) => x.producto_id)).toEqual(['p4', 'p1']);   // 30 antes que 4
    expect(difs[0]).toMatchObject({ mercado: 19.65, inventario: 49.65, diferencia: 30 });
    expect(difs[1]).toMatchObject({ mercado: 121, inventario: 117, diferencia: -4 });
  });

  it('un víver sin fila de stock cuenta como cero, no se ignora', () => {
    // Es el caso real: el libro dice que quedan 73 atunes y el almacén no tiene ninguno.
    const difs = diferenciasPorViver([MERCADO[1]], new Map());
    expect(difs).toHaveLength(1);
    expect(difs[0]).toMatchObject({ inventario: 0, diferencia: -73 });
  });

  it('ignora los residuos de redondeo por debajo de un centésimo', () => {
    const stock = new Map([['p3', 1.4001]]);
    expect(diferenciasPorViver([MERCADO[2]], stock)).toEqual([]);
  });
});

describe('totalesDeMercado', () => {
  it('encadena los cinco números del ciclo', () => {
    const t = totalesDeMercado(MERCADO);
    expect(t.saldoInicial).toBe(5.35);
    expect(t.entradas).toBe(226.9);
    expect(t.disponible).toBe(232.25);
    expect(t.consumos).toBe(12.2);
    expect(t.queda).toBe(220.05);
    // La identidad tiene que cerrar: disponible − consumos = queda.
    expect(t.disponible - t.consumos).toBeCloseTo(t.queda, 5);
  });

  it('sin inventario con qué comparar, no inventa una diferencia', () => {
    const t = totalesDeMercado(MERCADO);
    expect(t.inventario).toBeNull();
    expect(t.diferencia).toBeNull();
    expect(t.vieresConDiferencia).toBe(0);
  });

  it('con el inventario cuadrado, la diferencia es 0 y no hay víveres marcados', () => {
    const stock = new Map(MERCADO.map((x) => [x.producto_id, x.queda] as const));
    const t = totalesDeMercado(MERCADO, stock);
    expect(t.diferencia).toBe(0);
    expect(t.vieresConDiferencia).toBe(0);
  });

  it('con descuadre, informa el total y CUÁNTOS víveres lo causan', () => {
    // Que el total dé −4 no significa que haya un solo problema: pueden ser dos
    // que se compensan. Por eso se cuentan los víveres además de sumar.
    const stock = new Map(MERCADO.map((x) => [x.producto_id, x.queda] as const));
    stock.set('p1', 117);      // −4
    stock.set('p2', 83);       // +10
    const t = totalesDeMercado(MERCADO, stock);
    expect(t.diferencia).toBe(6);
    expect(t.vieresConDiferencia).toBe(2);
  });
});

describe('separarMovidos', () => {
  it('separa lo que se movió en el ciclo de lo que solo arrastra saldo', () => {
    const { movidos, quietos } = separarMovidos(MERCADO);
    expect(movidos.map((x) => x.producto_id)).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(quietos.map((x) => x.producto_id)).toEqual(['p5', 'p6']);
  });

  it('un consumo sin entrada también cuenta como movido', () => {
    const { movidos } = separarMovidos([d('x', 'SAL', 'KILOGRAMO', 5, 0, 1)]);
    expect(movidos).toHaveLength(1);
  });

  it('no se pierde nada: movidos + quietos es el total', () => {
    const { movidos, quietos } = separarMovidos(MERCADO);
    expect(movidos.length + quietos.length).toBe(MERCADO.length);
  });
});

describe('describirEvento', () => {
  const ev = (e: Partial<EventoMercado>): EventoMercado =>
    ({ at: '2026-09-02T10:00:00Z', evento: 'abierta', actor: 'a@mgg.com', ...e } as EventoMercado);

  it('nombra a quien abrió y a quien cerró', () => {
    expect(describirEvento(ev({ evento: 'abierta', actor_name: 'KELVIN' }))).toBe('Abrió KELVIN');
    expect(describirEvento(ev({ evento: 'cerrado', actor_name: 'JESUS' }))).toBe('Cerró JESUS');
    expect(describirEvento(ev({ evento: 'reabierto', actor_name: 'ANALISTA' }))).toBe('Reabrió ANALISTA');
  });

  it('al mercado que nace de un cierre NO le atribuye una apertura', () => {
    // Quien cierra un mercado no es necesariamente quien abre o trabaja el siguiente:
    // puede cerrar admin y abrir la analista. Decir «Abrió JESUS» sería inventar
    // un acto que nunca ocurrió.
    const texto = describirEvento(ev({ evento: 'generado_al_cerrar', actor_name: 'JESUS', al_cerrar: 1 }));
    expect(texto).toBe('Generado al cerrar el #1 (JESUS)');
    expect(texto).not.toContain('Abrió');
  });

  it('el cierre con ajuste dice cuántos víveres se tocaron', () => {
    expect(describirEvento(ev({ evento: 'cerrado', actor_name: 'JESUS', ajustado: true, ajustados: ['p1', 'p2'] })))
      .toBe('Cerró JESUS y ajustó 2 víveres');
    expect(describirEvento(ev({ evento: 'cerrado', actor_name: 'JESUS', ajustado: true, ajustados: ['p1'] })))
      .toBe('Cerró JESUS y ajustó 1 víver');
  });

  it('sin nombre cae al correo, y sin ninguno de los dos no inventa una persona', () => {
    expect(describirEvento(ev({ evento: 'cerrado', actor: 'jefa@mgg.com' }))).toBe('Cerró jefa@mgg.com');
    expect(describirEvento(ev({ evento: 'cerrado', actor: '', actor_name: '  ' }))).toBe('Cerró desconocido');
  });
});

describe('productosAjustados', () => {
  it('junta los víveres tocados por todas las intervenciones', () => {
    const hist: EventoMercado[] = [
      { at: '1', evento: 'abierta', actor: 'a' },
      { at: '2', evento: 'cerrado', actor: 'b', ajustado: true, ajustados: ['p1', 'p4'] },
      { at: '3', evento: 'reabierto', actor: 'c' },
      { at: '4', evento: 'cerrado', actor: 'b', ajustado: true, ajustados: ['p4', 'p9'] },
    ];
    expect([...productosAjustados(hist)].sort()).toEqual(['p1', 'p4', 'p9']);
  });

  it('un mercado sin historial no marca nada', () => {
    expect(productosAjustados([]).size).toBe(0);
    expect(productosAjustados(null).size).toBe(0);
  });
});

describe('compararConsumos', () => {
  const agg = (producto_id: string, nombre: string, cantidad: number): ItemAgg =>
    ({ producto_id, sku: producto_id, nombre, unidad: 'UNIDAD', cantidad, valor: cantidad });

  it('ordena por el salto más grande, no por el volumen', () => {
    const a = [agg('h', 'HARINA PAN', 120), agg('ar', 'ARROZ', 90), agg('ac', 'ACEITE', 24)];
    const b = [agg('h', 'HARINA PAN', 186), agg('ar', 'ARROZ', 88), agg('ac', 'ACEITE', 41)];
    const filas = compararConsumos(a, b);
    expect(filas.map((f) => f.producto_id)).toEqual(['h', 'ac', 'ar']);   // +66, +17, −2
    expect(filas[0]).toMatchObject({ a: 120, b: 186, delta: 66, pct: 55 });
    expect(filas[2]).toMatchObject({ delta: -2, pct: -2 });
  });

  it('un víver que aparece en un solo corte también se lista', () => {
    const filas = compararConsumos([agg('x', 'SAL', 10)], [agg('y', 'AZUCAR', 4)]);
    expect(filas.map((f) => f.producto_id).sort()).toEqual(['x', 'y']);
    expect(filas.find((f) => f.producto_id === 'x')).toMatchObject({ a: 10, b: 0, delta: -10, pct: -100 });
  });

  it('sin base en el corte viejo no se inventa un porcentaje', () => {
    // De 0 a 41 no es «+∞ %» ni «+4100 %»: no hay base contra la cual comparar.
    const filas = compararConsumos([], [agg('ac', 'ACEITE', 41)]);
    expect(filas[0]).toMatchObject({ a: 0, b: 41, delta: 41, pct: null });
  });

  it('los víveres que no se consumieron en ninguno de los dos cortes no ensucian la tabla', () => {
    const filas = compararConsumos([agg('z', 'BAYGON', 0)], [agg('z', 'BAYGON', 0)]);
    expect(filas).toEqual([]);
  });
});
