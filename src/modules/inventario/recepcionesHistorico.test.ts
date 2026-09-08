import { describe, it, expect } from 'vitest';
import {
  esMovimientoDeRecepcion, filtrarRecepciones, recepcionesDesdeMovimientos,
  type MovimientoRecepcion,
} from './recepcionesHistorico';

/* Las siete recepciones reales del 08/09/2026, todas de KELVIN. Sirven de caso
   porque incluyen lo incómodo: una orden con DOS ítems en el mismo instante y
   dos órdenes distintas que reciben el MISMO producto con minutos de diferencia. */
const m = (
  id: string, at: string, ref_codigo: string, producto_id: string, delta: number,
  extra: Partial<MovimientoRecepcion> = {},
): MovimientoRecepcion => ({
  id, at, producto_id, delta,
  ref_tipo: 'orden', ref_id: 'ord-' + ref_codigo, ref_codigo,
  actor: 'almacenmatanzas2026@gmail.com', actor_name: 'KELVIN',
  almacen: 'General', precio_unitario: 1, detalle: null,
  ...extra,
});

const REALES: MovimientoRecepcion[] = [
  m('1', '2026-09-08T14:54:11.411144+00:00', 'SP-2026-0128', 'p-eqp022', 1, { precio_unitario: 60 }),
  m('2', '2026-09-08T14:54:19.414712+00:00', 'SP-2026-0126', 'p-rep050', 1, { precio_unitario: 22.02 }),
  m('3', '2026-09-08T14:54:27.453630+00:00', 'SP-2026-0124', 'p-seg005', 1, { precio_unitario: 28 }),
  m('4', '2026-09-08T14:55:20.696739+00:00', 'SP-2026-0113', 'p-seg005', 1, { precio_unitario: 28 }),
  // Una sola recepción con DOS ítems: mismo instante, misma orden.
  m('5', '2026-09-08T14:56:05.036345+00:00', 'SP-2026-0110-1', 'p-epp004', 96, { precio_unitario: 0.42 }),
  m('6', '2026-09-08T14:56:05.052071+00:00', 'SP-2026-0110-1', 'p-epp020', 12, { precio_unitario: 1.5 }),
];

describe('esMovimientoDeRecepcion', () => {
  it('reconoce las entradas por orden y por compra directa', () => {
    expect(esMovimientoDeRecepcion(m('x', '2026-09-08T10:00:00Z', 'SP-1', 'p', 5))).toBe(true);
    expect(esMovimientoDeRecepcion(m('x', '2026-09-08T10:00:00Z', 'CD-1', 'p', 5, { ref_tipo: 'compra_directa' }))).toBe(true);
  });

  it('descarta lo que no es una recepción', () => {
    // Una salida de cocina, un ajuste manual y la reversa de una compra directa
    // comparten tabla con las recepciones pero no son una.
    expect(esMovimientoDeRecepcion(m('x', '2026-09-08T10:00:00Z', 'COC-1', 'p', 5, { ref_tipo: 'cocina' }))).toBe(false);
    expect(esMovimientoDeRecepcion(m('x', '2026-09-08T10:00:00Z', '—', 'p', 5, { ref_tipo: 'manual' }))).toBe(false);
    expect(esMovimientoDeRecepcion(m('x', '2026-09-08T10:00:00Z', 'CD-1', 'p', -5, { ref_tipo: 'compra_directa' }))).toBe(false);
  });
});

describe('recepcionesDesdeMovimientos', () => {
  it('junta en UNA recepción los ítems recibidos en el mismo instante', () => {
    const recs = recepcionesDesdeMovimientos(REALES);
    expect(recs).toHaveLength(5);                       // 6 movimientos, 5 recepciones
    const dosItems = recs.find((r) => r.documento === 'SP-2026-0110-1')!;
    expect(dosItems.items).toHaveLength(2);
    expect(dosItems.unidades).toBe(108);
  });

  it('NO junta dos órdenes distintas aunque traigan el mismo producto', () => {
    // SP-2026-0124 y SP-2026-0113 recibieron ambas el mismo SEG-005.
    const recs = recepcionesDesdeMovimientos(REALES);
    const conSeg = recs.filter((r) => r.items.some((i) => i.producto_id === 'p-seg005'));
    expect(conSeg).toHaveLength(2);
    expect(new Set(conSeg.map((r) => r.documento)).size).toBe(2);
  });

  it('devuelve de la más reciente a la más vieja', () => {
    const recs = recepcionesDesdeMovimientos(REALES);
    expect(recs[0].documento).toBe('SP-2026-0110-1');
    expect(recs[recs.length - 1].documento).toBe('SP-2026-0128');
  });

  it('conserva quién recibió y a qué almacén entró', () => {
    const r = recepcionesDesdeMovimientos(REALES)[0];
    expect(r.actor_name).toBe('KELVIN');
    expect(r.almacen).toBe('General');
  });

  it('suma el valor solo si TODOS los renglones traen precio', () => {
    const r = recepcionesDesdeMovimientos(REALES).find((x) => x.documento === 'SP-2026-0110-1')!;
    expect(r.valor).toBeCloseTo(96 * 0.42 + 12 * 1.5, 4);

    // Con un renglón sin precio el total sería MENOR que el real: mejor no darlo.
    const sinPrecio = recepcionesDesdeMovimientos([
      m('a', '2026-09-08T12:00:00Z', 'SP-9', 'p1', 2, { precio_unitario: 10 }),
      m('b', '2026-09-08T12:00:00Z', 'SP-9', 'p2', 3, { precio_unitario: null }),
    ])[0];
    expect(sinPrecio.valor).toBeNull();
    expect(sinPrecio.unidades).toBe(5);
  });

  it('las recepciones viejas no inventan un almacén', () => {
    // Antes del 08/09/2026 el movimiento no guardaba la columna.
    const vieja = recepcionesDesdeMovimientos([
      m('v', '2026-08-01T12:00:00Z', 'SP-8', 'p1', 1, { almacen: null, detalle: 'Recepción … → General' }),
    ])[0];
    expect(vieja.almacen).toBeNull();
  });
});

describe('el código de la recepción', () => {
  it('con una sola recepción, el documento la nombra', () => {
    const r = recepcionesDesdeMovimientos(REALES).find((x) => x.documento === 'SP-2026-0128')!;
    expect(r.codigo).toBe('SP-2026-0128');
    expect(r.numero).toBe(1);
  });

  it('con recepciones parciales, se numeran en orden cronológico', () => {
    // La misma orden recibida en dos tandas: son dos recepciones distintas.
    const parciales = recepcionesDesdeMovimientos([
      m('b', '2026-09-05T09:00:00Z', 'SP-2026-0200', 'p1', 3),
      m('a', '2026-09-01T09:00:00Z', 'SP-2026-0200', 'p1', 7),
    ]);
    expect(parciales.map((r) => r.codigo)).toEqual(['SP-2026-0200 · R2', 'SP-2026-0200 · R1']);
    const r1 = parciales.find((r) => r.numero === 1)!;
    expect(String(r1.at).slice(0, 10)).toBe('2026-09-01');
  });

  it('el número no depende de qué otras órdenes se consultaron', () => {
    // Un correlativo global se correría al aparecer una recepción más vieja de
    // otra orden; el que va por documento no.
    const solas = recepcionesDesdeMovimientos([
      m('a', '2026-09-01T09:00:00Z', 'SP-A', 'p1', 1),
      m('b', '2026-09-05T09:00:00Z', 'SP-A', 'p1', 1),
    ]);
    const conOtra = recepcionesDesdeMovimientos([
      m('z', '2026-08-01T09:00:00Z', 'SP-B', 'p9', 1),
      m('a', '2026-09-01T09:00:00Z', 'SP-A', 'p1', 1),
      m('b', '2026-09-05T09:00:00Z', 'SP-A', 'p1', 1),
    ]);
    const codigos = (rs: ReturnType<typeof recepcionesDesdeMovimientos>) =>
      rs.filter((r) => r.documento === 'SP-A').map((r) => r.codigo);
    expect(codigos(solas)).toEqual(codigos(conOtra));
  });
});

describe('filtrarRecepciones', () => {
  const recs = recepcionesDesdeMovimientos(REALES);

  it('sin filtros devuelve todo', () => {
    expect(filtrarRecepciones(recs, {})).toHaveLength(recs.length);
  });

  it('filtra por día, por almacén y por quién recibió', () => {
    expect(filtrarRecepciones(recs, { desde: '2026-09-08', hasta: '2026-09-08' })).toHaveLength(5);
    expect(filtrarRecepciones(recs, { desde: '2026-09-09' })).toHaveLength(0);
    expect(filtrarRecepciones(recs, { almacen: 'General' })).toHaveLength(5);
    expect(filtrarRecepciones(recs, { almacen: 'Los Pinos' })).toHaveLength(0);
    expect(filtrarRecepciones(recs, { actor: 'almacenmatanzas2026@gmail.com' })).toHaveLength(5);
  });

  it('el buscador mira el código, quién recibió y el detalle', () => {
    expect(filtrarRecepciones(recs, { texto: '0110' })).toHaveLength(1);
    expect(filtrarRecepciones(recs, { texto: 'kelvin' })).toHaveLength(5);
    expect(filtrarRecepciones(recs, { texto: 'zzz' })).toHaveLength(0);
  });
});
