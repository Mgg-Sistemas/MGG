import { describe, it, expect } from 'vitest';
import {
  cicloQueSePisa, explicarDiferencia, explicarSobrante, inicioExactoDe, primerDiaLibre, ventanaCicloDe,
  compararConsumos, describirEvento, diferenciasPorViver, productosAjustados,
  deltaEfectivo, separarMovidos, stockAlCorte, totalesDeMercado, trasladosSinLlegada,
} from './mercadoComparar';
import type { CierreSnapshot, DisponibleItem, EventoMercado, ItemAgg } from './mercados.repository';
import type { PataTraslado, SalidaFueraDelCiclo, VentanaCiclo } from './mercadoComparar';

// Víveres reales de La Esperanza, con los números que muestra la pantalla hoy.
const d = (
  producto_id: string, nombre: string, unidad: string,
  saldoInicial: number, entradas: number, consumos: number, traslados = 0,
): DisponibleItem => ({
  producto_id, sku: producto_id, nombre, unidad, precio: 1,
  saldoInicial, entradas, traslados, consumos,
  disponible: Math.round((saldoInicial + entradas + traslados) * 100) / 100,
  queda: Math.round((saldoInicial + entradas + traslados - consumos) * 100) / 100,
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

describe('explicarDiferencia — por dónde se fue el faltante', () => {
  /* El caso real del ARROZ VIV-057 en Los Pinos: el libro decía que quedaban 52,
     el almacén tenía 20, y los 32 de diferencia habían salido el 08/09 por una
     salida manual de NAZARET sin ningún detalle escrito. */
  const s = (
    cantidad: number, at: string, tipo = 'salida', actor_name: string | null = 'NAZARET',
  ): SalidaFueraDelCiclo => ({
    producto_id: 'p-arroz', at, cantidad, tipo, actor_name, detalle: null,
  });

  it('nombra el movimiento que explica el faltante', () => {
    const e = explicarDiferencia(-32, [s(32, '2026-09-08T13:50:00Z')])!;
    expect(e.total).toBe(32);
    expect(e.explicaTodo).toBe(true);
    expect(e.sinExplicar).toBe(0);
    expect(e.ultimo).toMatchObject({ actor: 'NAZARET', tipo: 'salida', cantidad: 32 });
  });

  it('agrupa por tipo y pone primero el más grande', () => {
    const e = explicarDiferencia(-45, [
      s(32, '2026-09-08T13:50:00Z', 'salida'),
      s(10, '2026-09-01T10:00:00Z', 'ajuste'),
      s(3, '2026-08-30T10:00:00Z', 'ajuste'),
    ])!;
    expect(e.porTipo[0]).toEqual({ tipo: 'salida', cantidad: 32, movimientos: 1 });
    expect(e.porTipo[1]).toEqual({ tipo: 'ajuste', cantidad: 13, movimientos: 2 });
  });

  it('el «último» es el más reciente, no el primero de la lista', () => {
    const e = explicarDiferencia(-40, [
      s(10, '2026-08-30T10:00:00Z'),
      s(30, '2026-09-08T13:50:00Z'),
    ])!;
    expect(e.ultimo!.at).toBe('2026-09-08T13:50:00Z');
  });

  it('si las salidas NO alcanzan, lo dice en vez de dar el caso por cerrado', () => {
    // Decir «esto lo explica» cuando queda un resto es peor que no decir nada:
    // manda a cerrar una investigación que sigue abierta.
    const e = explicarDiferencia(-50, [s(32, '2026-09-08T13:50:00Z')])!;
    expect(e.explicaTodo).toBe(false);
    expect(e.sinExplicar).toBe(18);
  });

  it('un SOBRANTE no se explica con salidas', () => {
    // Si en el almacén hay de más, ninguna salida lo justifica: inventarle una
    // causa sería peor que admitir que no se sabe.
    expect(explicarDiferencia(30, [s(32, '2026-09-08T13:50:00Z')])).toBeNull();
  });

  it('sin movimientos por fuera del ciclo no hay nada que explicar', () => {
    expect(explicarDiferencia(-32, [])).toBeNull();
    expect(explicarDiferencia(-32, [s(0, '2026-09-08T13:50:00Z')])).toBeNull();
  });
});

describe('describirEvento · mercado descartado', () => {
  it('nombra a quien lo descartó', () => {
    const e: EventoMercado = {
      at: '2026-09-08T21:00:00Z', evento: 'descartado',
      actor: 'a@mgg.com', actor_name: 'ANALISTA', motivo: 'ciclo accidentado',
    };
    expect(describirEvento(e)).toBe('Descartó ANALISTA');
  });
});

describe('explicarSobrante — cuando en el almacén hay de MÁS', () => {
  it('el libro en negativo es el caso grave y se nombra así', () => {
    // Caso real de MONTE SURTIDO HTL-006: inventario 2,4 y «sobran 3», o sea que
    // el libro dice −0,6. No sobra comida: al ciclo le falta una entrada.
    const v = d('p-monte', 'MONTE SURTIDO', 'UNIDAD', 0, 0, 0.6);
    expect(v.queda).toBeCloseTo(-0.6, 6);
    expect(explicarSobrante(v)).toContain('negativo');
  });

  it('consumido sin ninguna entrada registrada', () => {
    const v = d('p', 'X', 'UNIDAD', 0, 0, 0);
    expect(explicarSobrante({ ...v, consumos: 0 })).toContain('nunca lo vio entrar');
  });

  it('con saldo y entradas, el sobrante es material que entró sin registrarse', () => {
    const v = d('p', 'X', 'UNIDAD', 10, 5, 2);
    expect(explicarSobrante(v)).toContain('sin quedar registrado');
  });
});

describe('cicloQueSePisa — no abrir un mercado encima de otro', () => {
  const previos: VentanaCiclo[] = [
    { numero: 1, fecha_inicio: '2026-08-22', fecha_fin: '2026-09-11', estado: 'cerrado', descartado: true },
  ];

  it('detecta el solapamiento exacto', () => {
    // El caso peligroso: descartar el #1 y volver a abrir con su misma fecha.
    expect(cicloQueSePisa('2026-08-22', '2026-09-11', previos)?.numero).toBe(1);
  });

  it('detecta el solapamiento parcial, por los dos lados', () => {
    expect(cicloQueSePisa('2026-09-05', '2026-09-25', previos)).not.toBeNull();
    expect(cicloQueSePisa('2026-08-10', '2026-08-30', previos)).not.toBeNull();
    // Y el que envuelve por completo al anterior.
    expect(cicloQueSePisa('2026-08-01', '2026-09-30', previos)).not.toBeNull();
  });

  it('un ciclo que empieza justo al día siguiente NO se pisa', () => {
    expect(cicloQueSePisa('2026-09-12', '2026-10-02', previos)).toBeNull();
  });

  it('el último día del anterior SÍ se pisa: la ventana es inclusiva', () => {
    expect(cicloQueSePisa('2026-09-11', '2026-10-01', previos)).not.toBeNull();
  });

  it('un DESCARTADO también estorba', () => {
    // Se descarta porque sus cifras no sirven; reabrir sobre su ventana las
    // reactiva, que es exactamente lo que se quería evitar.
    expect(cicloQueSePisa('2026-08-25', '2026-09-14', previos)?.descartado).toBe(true);
  });

  it('sin ciclos previos, cualquier ventana está libre', () => {
    expect(cicloQueSePisa('2026-08-22', '2026-09-11', [])).toBeNull();
  });
});

describe('primerDiaLibre', () => {
  it('es el día siguiente al fin del último ciclo', () => {
    expect(primerDiaLibre([
      { numero: 1, fecha_inicio: '2026-08-22', fecha_fin: '2026-09-11' },
      { numero: 2, fecha_inicio: '2026-07-01', fecha_fin: '2026-07-21' },
    ])).toBe('2026-09-12');
  });

  it('sin ciclos no hay restricción', () => {
    expect(primerDiaLibre([])).toBeNull();
  });
});

describe('traslados en el libro del mercado', () => {
  it('la cocina que reparte resta, la que recibe suma, y las dos cuadran', () => {
    // Llegan 300 arroces a Los Pinos, se mandan 120 a La Esperanza y cada una cocina 30.
    // Antes Los Pinos daba «faltan 120» y La Esperanza contaba los 120 como entrada.
    const pinos = [d('arroz', 'ARROZ MARY', 'UNIDAD', 0, 300, 30, -120)];
    const esperanza = [d('arroz', 'ARROZ MARY', 'UNIDAD', 0, 0, 30, 120)];
    expect(totalesDeMercado(pinos, new Map([['arroz', 150]])))
      .toMatchObject({ entradas: 300, traslados: -120, disponible: 180, queda: 150, diferencia: 0 });
    expect(totalesDeMercado(esperanza, new Map([['arroz', 90]])))
      .toMatchObject({ entradas: 0, traslados: 120, disponible: 120, queda: 90, diferencia: 0 });
  });

  it('un víver que solo se trasladó cuenta como movido', () => {
    const { movidos } = separarMovidos([d('sal', 'SAL', 'KILOGRAMO', 10, 0, 0, -4)]);
    expect(movidos).toHaveLength(1);
  });

  it('lo que llegó por traslado es una entrada del ciclo al explicar un sobrante', () => {
    expect(explicarSobrante(d('p', 'X', 'UNIDAD', 0, 0, 0, 20))).not.toContain('nunca lo vio entrar');
  });
});

describe('trasladosSinLlegada — la salida tiene que tener su llegada', () => {
  const pata = (
    id: string, producto_id: string, almacen: string, delta: number, at: string,
    extra: Partial<PataTraslado> = {},
  ): PataTraslado => ({ id, producto_id, almacen, delta, at, ...extra });

  it('un traslado con sus dos patas llegó', () => {
    const s = [pata('s1', 'arroz', 'Los Pinos', -24, '2026-09-14T14:23:00Z')];
    const e = [pata('e1', 'arroz', 'La Esperanza', 24, '2026-09-14T14:23:02Z')];
    expect(trasladosSinLlegada(s, e)).toEqual([]);
  });

  it('la salida sin entrada se señala con lo que falta llegar', () => {
    // 26/08: 101,5 arroces salieron de La Esperanza y no entraron a ningún almacén.
    const r = trasladosSinLlegada([pata('s1', 'arroz', 'La Esperanza', -101.5, '2026-08-26T16:23:00Z')], []);
    expect(r).toHaveLength(1);
    expect(r[0].faltaLlegar).toBe(101.5);
  });

  it('una sola entrada puede juntar varias salidas', () => {
    // Consolidación de Matanza, 04/09: 48 desde Resguardo + 24 desde Víveres → 72 en General.
    const s = [
      pata('s1', 'arroz', 'Resguardo', -48, '2026-09-04T17:55:00Z'),
      pata('s2', 'arroz', 'Viveres', -24, '2026-09-04T17:55:01Z'),
    ];
    const e = [pata('e1', 'arroz', 'General', 72, '2026-09-04T17:55:02Z')];
    expect(trasladosSinLlegada(s, e)).toEqual([]);
  });

  it('una entrada no alcanza para dos salidas: la segunda queda sin llegada', () => {
    const s = [
      pata('s1', 'sal', 'Los Pinos', -10, '2026-09-14T14:00:00Z'),
      pata('s2', 'sal', 'Los Pinos', -10, '2026-09-14T14:00:05Z'),
    ];
    const r = trasladosSinLlegada(s, [pata('e1', 'sal', 'La Esperanza', 10, '2026-09-14T14:00:02Z')]);
    expect(r.map((x) => x.salida.id)).toEqual(['s2']);
  });

  it('el reverso en el mismo almacén cuenta: la mercancía volvió', () => {
    const s = [pata('s1', 'sal', 'Los Pinos', -10, '2026-09-14T14:00:00Z')];
    const e = [pata('r1', 'sal', 'Los Pinos', 10, '2026-09-14T14:00:03Z', { detalle: 'Reverso: la entrada a La Esperanza no se pudo registrar' })];
    expect(trasladosSinLlegada(s, e)).toEqual([]);
  });

  it('otra entrada en el mismo almacén que NO es un reverso no tapa la salida', () => {
    const s = [pata('s1', 'sal', 'Los Pinos', -10, '2026-09-14T14:00:00Z')];
    const e = [pata('x1', 'sal', 'Los Pinos', 10, '2026-09-14T14:00:03Z', { detalle: 'Traslado desde Resguardo' })];
    expect(trasladosSinLlegada(s, e)).toHaveLength(1);
  });

  it('dos solicitudes distintas no se cruzan aunque coincidan producto, cantidad y minuto', () => {
    const s = [pata('s1', 'sal', 'Los Pinos', -10, '2026-09-14T14:00:00Z', { ref_id: 'tra-7' })];
    const e = [pata('e1', 'sal', 'La Esperanza', 10, '2026-09-14T14:00:02Z', { ref_id: 'tra-8' })];
    expect(trasladosSinLlegada(s, e)).toHaveLength(1);
  });

  it('una entrada muy posterior no es la llegada de esa salida', () => {
    const s = [pata('s1', 'sal', 'Los Pinos', -10, '2026-09-14T14:00:00Z')];
    const e = [pata('e1', 'sal', 'La Esperanza', 10, '2026-09-14T16:00:00Z')];
    expect(trasladosSinLlegada(s, e)).toHaveLength(1);
  });
});

describe('deltaEfectivo — lo que un movimiento bajó de verdad', () => {
  it('una salida normal es su delta', () => {
    expect(deltaEfectivo({ delta: -24, stock_antes: 100, stock_despues: 76 })).toBe(-24);
  });

  it('una salida topeada en cero bajó solo lo que había', () => {
    // 26/08: un traslado de 101,5 desde un almacén que tenía 24.
    expect(deltaEfectivo({ delta: -101.5, stock_antes: 24, stock_despues: 0 })).toBe(-24);
  });

  it('desde un almacén vacío no bajó nada', () => {
    expect(deltaEfectivo({ delta: -5, stock_antes: 0, stock_despues: 0 })).toBe(0);
  });

  it('sin stock antes y después no hay con qué corregir: manda el delta', () => {
    expect(deltaEfectivo({ delta: -5 })).toBe(-5);
    expect(deltaEfectivo({ delta: -5, stock_antes: null, stock_despues: 0 })).toBe(-5);
  });

  it('las entradas no se tocan', () => {
    expect(deltaEfectivo({ delta: 10, stock_antes: 0, stock_despues: 10 })).toBe(10);
  });
});

describe('stockAlCorte — el inventario al último día del ciclo', () => {
  it('sin nada después del corte es el stock de ahora', () => {
    expect(stockAlCorte(new Map([['arroz', 90]]), [], new Map()).get('arroz')).toBe(90);
  });

  it('deshace el reparto y las compras posteriores al corte', () => {
    // Hoy hay 150; después del corte salieron 120 por traslado y entraron 50 de una compra.
    const r = stockAlCorte(new Map([['arroz', 150]]), [
      { producto_id: 'arroz', delta: -120, ref_tipo: 'traslado_modulo' },
      { producto_id: 'arroz', delta: 50, ref_tipo: 'orden' },
    ], new Map());
    expect(r.get('arroz')).toBe(220);
  });

  it('una comida posterior al corte se devuelve por su día, no por su movimiento', () => {
    const r = stockAlCorte(
      new Map([['arroz', 90]]),
      [{ producto_id: 'arroz', delta: -10, ref_tipo: 'cocina' }],
      new Map([['arroz', 10]]),
    );
    expect(r.get('arroz')).toBe(100);
  });

  it('deshace lo que el movimiento bajó de verdad, no lo que pidió', () => {
    // Una salida de 100 topeada: el almacén tenía 30 y quedó en 0. Al corte había 30 más, no 100.
    const mov = { producto_id: 'arroz', delta: -100, stock_antes: 30, stock_despues: 0, ref_tipo: 'manual' };
    const r = stockAlCorte(new Map([['arroz', 0]]), [{ ...mov, delta: deltaEfectivo(mov) }], new Map());
    expect(r.get('arroz')).toBe(30);
  });

  it('una comida del ciclo cargada tarde NO se devuelve: el libro ya la cuenta', () => {
    // Comida del último día cargada dos días después: su movimiento cae después del corte.
    const r = stockAlCorte(new Map([['arroz', 90]]), [{ producto_id: 'arroz', delta: -10, ref_tipo: 'cocina' }], new Map());
    expect(r.get('arroz')).toBe(90);
  });
});

describe('apertura al instante — el ciclo cuenta desde que se abre', () => {
  const ev = (e: Partial<EventoMercado>): EventoMercado =>
    ({ at: '2026-09-14T20:38:00Z', evento: 'abierta', actor: 'a@mgg.com', ...e } as EventoMercado);

  it('el inicio exacto sale del evento de apertura', () => {
    expect(inicioExactoDe([ev({ desde: '2026-09-14T20:38:00.000Z' })])).toBe('2026-09-14T20:38:00.000Z');
  });

  it('un mercado generado al cerrar el anterior no tiene inicio exacto: sigue desde las 00:00', () => {
    expect(inicioExactoDe([ev({ evento: 'generado_al_cerrar', al_cerrar: 1 })])).toBeNull();
  });

  it('los abiertos antes del cambio tampoco: su evento no trae `desde`', () => {
    expect(inicioExactoDe([ev({})])).toBeNull();
    expect(inicioExactoDe([])).toBeNull();
    expect(inicioExactoDe(null)).toBeNull();
  });
});

describe('cicloQueSePisa — un descartado deja de ocupar sus días al descartarse', () => {
  // El #2 de Los Pinos se abrió el 14/09 a las 16:38 con la fecha equivocada.
  const descartado: VentanaCiclo = {
    numero: 2, fecha_inicio: '2026-09-14', fecha_fin: '2026-10-04', estado: 'cerrado',
    descartado: true, descartado_en: '2026-09-14T20:50:00.000Z',
  };

  it('abrir después del descarte ya no choca, aunque sea el mismo día', () => {
    expect(cicloQueSePisa('2026-09-14', '2026-10-04', [descartado], '2026-09-14T20:55:00.000Z')).toBeNull();
  });

  it('un ciclo que empezara antes del descarte sí lo pisa', () => {
    expect(cicloQueSePisa('2026-09-14', '2026-10-04', [descartado], '2026-09-14T20:40:00.000Z')?.numero).toBe(2);
  });

  it('un cerrado que no se descartó sigue ocupando sus días', () => {
    const cerrado: VentanaCiclo = { ...descartado, descartado: false, descartado_en: null };
    expect(cicloQueSePisa('2026-09-20', '2026-10-10', [cerrado], '2026-09-20T12:00:00.000Z')?.numero).toBe(2);
  });

  it('ventanaCicloDe toma el instante del descarte del cierre', () => {
    const v = ventanaCicloDe({
      numero: 2, fecha_inicio: '2026-09-14', fecha_fin: '2026-10-04', estado: 'cerrado',
      cierre: { descartado: true, generado_en: '2026-09-14T20:50:00.000Z' } as CierreSnapshot,
    });
    expect(v).toMatchObject({ descartado: true, descartado_en: '2026-09-14T20:50:00.000Z' });
  });
});
