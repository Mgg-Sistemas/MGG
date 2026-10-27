import { describe, expect, it } from 'vitest';
import {
  cicloDias, distribucionPorViver, estadoStock, frecuenciaAnual, loteOptimo, puntoReorden,
  stockDesdeContraste, tieneDescuadre, totalesDistribucion, type ParametrosEoq,
} from './distribucionEoq';
import type { DisponibleItem, KardexRow } from './mercados.repository';
import type { CocinaComida } from '@/shared/lib/types';

/* Los números de la planilla «Control de consumo de pollo» (hojas Los Pinos y La Esperanza). */
describe('modelo EOQ (contra la planilla del pollo)', () => {
  it('Los Pinos: D=1700, S=3, H=1, L=3 → Q*=101, ROP=14, ciclo 22 días, 16,8 órdenes/año', () => {
    const p: ParametrosEoq = { costoOrden: 3, costoAlmacenar: 1, leadTimeDias: 3 };
    const q = loteOptimo(1700, p);
    expect(q).toBe(101);
    expect(puntoReorden(1700, p)).toBe(14);
    expect(cicloDias(q, 1700)).toBe(22);
    expect(frecuenciaAnual(q, 1700)).toBeCloseTo(16.83, 1);
  });

  it('La Esperanza: D=360, S=3,33, H=1,2, L=2 → Q*=45, ROP=2', () => {
    const p: ParametrosEoq = { costoOrden: 3.33, costoAlmacenar: 1.2, leadTimeDias: 2 };
    expect(loteOptimo(360, p)).toBe(45);
    expect(puntoReorden(360, p)).toBe(2);
  });

  it('sin consumo no hay lote ni punto de reorden', () => {
    expect(loteOptimo(0, { costoOrden: 3, costoAlmacenar: 1, leadTimeDias: 3 })).toBe(0);
    expect(puntoReorden(0, { costoOrden: 3, costoAlmacenar: 1, leadTimeDias: 3 })).toBe(0);
  });

  it('semáforo: en el punto o debajo REORDENAR, hasta 1,5 veces ALERTA', () => {
    expect(estadoStock(9, 14)).toBe('REORDENAR');
    expect(estadoStock(14, 14)).toBe('REORDENAR');
    expect(estadoStock(18, 14)).toBe('ALERTA');
    expect(estadoStock(27, 14)).toBe('NORMAL');
    expect(estadoStock(0, 0)).toBe('NORMAL');
  });
});

const viver = (over: Partial<DisponibleItem> = {}): DisponibleItem => ({
  producto_id: 'p1', sku: 'VIV-001', nombre: 'POLLO', unidad: 'UNIDAD', precio: 5,
  saldoInicial: 0, entradas: 0, traslados: 0, consumos: 0, mermas: 0, disponible: 0, queda: 0, ...over,
});
const comida = (at: string, platos: number, cantidad: number, tipo = 'almuerzo'): KardexRow => ({
  kind: 'consumo', at, items: 1, cantidad,
  comida: { id: at, codigo: 'C', tipo_comida: tipo, platos, items: [{ producto_id: 'p1', cantidad }], valor_total: 0, at } as unknown as CocinaComida,
});

describe('distribucionPorViver', () => {
  const p: ParametrosEoq = { costoOrden: 3, costoAlmacenar: 1, leadTimeDias: 3 };

  it('arma el registro diario encadenando el inventario, como la planilla', () => {
    const kardex: KardexRow[] = [
      { kind: 'entrada', at: '2026-09-01T10:00:00Z', producto_id: 'p1', nombre: 'POLLO', unidad: 'UNIDAD', cantidad: 55, valor: 0, detalle: null, almacen: null },
      comida('2026-09-02T12:00:00Z', 48, 9),
      comida('2026-09-03T12:00:00Z', 72, 10),
    ];
    const [d] = distribucionPorViver([viver({ queda: 36 })], kardex, p);
    expect(d.filas.map((f) => [f.fecha, f.invInicial, f.entradas, f.salidas, f.teorico])).toEqual([
      ['2026-09-01', 0, 55, 0, 55],
      ['2026-09-02', 55, 0, 9, 46],
      ['2026-09-03', 46, 0, 10, 36],
    ]);
    expect(d.consumoTotal).toBe(19);
    expect(d.diasConConsumo).toBe(2);
    expect(d.promedioDia).toBe(9.5);
    expect(d.demandaAnual).toBe(Math.round(9.5 * 365));
    expect(d.filas[1].ratio).toBeCloseTo(9 / 48, 4);
    expect(d.comensales).toBe(120);
  });

  it('la merma del día baja el físico y queda como diferencia negativa', () => {
    const kardex: KardexRow[] = [
      comida('2026-09-02T12:00:00Z', 48, 8),
      { kind: 'merma', at: '2026-09-02T18:00:00Z', producto_id: 'p1', nombre: 'POLLO', unidad: 'UNIDAD', cantidad: 1, valor: 0, tipo: 'salida', detalle: null, almacen: null, actor_name: null },
    ];
    const [d] = distribucionPorViver([viver({ saldoInicial: 18, queda: 9 })], kardex, p);
    expect(d.filas[0]).toMatchObject({ invInicial: 18, salidas: 8, teorico: 10, mermas: 1, fisico: 9, diferencia: -1 });
    expect(d.mermas).toBe(1);
  });

  it('un traslado recibido suma y uno enviado resta', () => {
    const base = { producto_id: 'p1', nombre: 'POLLO', unidad: 'UNIDAD', valor: 0, detalle: null, almacen: null, contraparte: null, interno: false, codigo: null, sinLlegada: 0 };
    const kardex: KardexRow[] = [
      { kind: 'traslado', id: 't1', at: '2026-09-01T10:00:00Z', cantidad: 10, ...base },
      { kind: 'traslado', id: 't2', at: '2026-09-02T10:00:00Z', cantidad: -4, ...base },
    ];
    const [d] = distribucionPorViver([viver({ queda: 6 })], kardex, p);
    expect(d.filas[0]).toMatchObject({ entradas: 10, teorico: 10, fisico: 10 });
    expect(d.filas[1]).toMatchObject({ entradas: 0, mermas: 4, fisico: 6 });
  });

  it('separa los turnos del día y cuenta los comensales de cada uno', () => {
    const kardex: KardexRow[] = [
      comida('2026-09-02T08:00:00Z', 40, 3, 'desayuno'),
      comida('2026-09-02T12:00:00Z', 60, 6, 'almuerzo'),
    ];
    const [d] = distribucionPorViver([viver({ saldoInicial: 20, queda: 11 })], kardex, p);
    expect(d.filas).toHaveLength(2);
    expect(d.filas.map((f) => [f.turno, f.salidas, f.comensales, f.fisico])).toEqual([
      ['desayuno', 3, 40, 17],
      ['almuerzo', 6, 60, 11],
    ]);
    expect(d.diasConConsumo).toBe(1);
  });

  it('un víver sin movimientos queda en NORMAL y sin filas', () => {
    const [d] = distribucionPorViver([viver({ saldoInicial: 5, queda: 5 })], [], p);
    expect(d.filas).toEqual([]);
    expect(d.estado).toBe('NORMAL');
    expect(d.eoq).toBe(0);
  });

  it('los totales cuentan los víveres por reponer', () => {
    const kardex: KardexRow[] = [comida('2026-09-02T12:00:00Z', 48, 9)];
    const items = distribucionPorViver([viver({ saldoInicial: 10, queda: 1 })], kardex, p);
    expect(items[0].estado).toBe('REORDENAR');
    expect(totalesDistribucion(items)).toMatchObject({ viveres: 1, reordenar: 1, alerta: 0, consumoTotal: 9 });
  });
});

/* El caso del 27/10/2026: La Esperanza, mercado #4, POLLO BENEFICIADO PURO LOMO
   (POT-002). El libro arrastraba 12 de saldo inicial y el almacén tenía 10. */
describe('stock actual = inventario real, el libro va aparte', () => {
  const p: ParametrosEoq = { costoOrden: 3.33, costoAlmacenar: 1.2, leadTimeDias: 2 };
  const pollo = viver({ producto_id: 'pollo', sku: 'POT-002', nombre: 'POLLO BENEFICIADO PURO LOMO', saldoInicial: 12, queda: 12 });

  it('el stock sale del inventario del almacén y el libro queda como referencia, con la diferencia', () => {
    const [d] = distribucionPorViver([pollo], [], p, new Map([['pollo', 10]]));
    expect(d.stock).toBe(10);
    expect(d.libro).toBe(12);
    expect(d.diferencia).toBe(-2);
    expect(tieneDescuadre(d)).toBe(true);
  });

  it('sin inventario que leer, el stock es el libro y no se afirma ninguna diferencia', () => {
    const [d] = distribucionPorViver([pollo], [], p);
    expect(d.stock).toBe(12);
    expect(d.libro).toBe(12);
    expect(d.diferencia).toBeNull();
    expect(tieneDescuadre(d)).toBe(false);
  });

  it('un víver del libro que no está en el inventario del centro tiene 0 en el almacén', () => {
    const [d] = distribucionPorViver([pollo], [], p, new Map([['otro', 5]]));
    expect(d.stock).toBe(0);
    expect(d.diferencia).toBe(-12);
  });

  it('menos de un centésimo es redondeo, no descuadre', () => {
    const [d] = distribucionPorViver([pollo], [], p, new Map([['pollo', 12.004]]));
    expect(d.diferencia).toBe(0);
    expect(tieneDescuadre(d)).toBe(false);
  });

  it('el semáforo y el punto de reorden se miden con el stock real, no con el libro', () => {
    // Consumo 4/día → D = 1460 → ROP = 8 (2 días de entrega). El libro dice 14 (NORMAL),
    // el almacén tiene 6 (REORDENAR): manda el almacén.
    const kardex: KardexRow[] = [comida('2026-10-25T12:00:00Z', 30, 4, 'almuerzo')];
    const items = distribucionPorViver([viver({ producto_id: 'p1', saldoInicial: 18, queda: 14 })], kardex, p, new Map([['p1', 6]]));
    expect(items[0].puntoReorden).toBe(8);
    expect(items[0].stock).toBe(6);
    expect(items[0].estado).toBe('REORDENAR');
    expect(totalesDistribucion(items)).toMatchObject({ reordenar: 1, descuadrados: 1 });
    // El mismo víver sin inventario leído se mide con el libro.
    expect(distribucionPorViver([viver({ producto_id: 'p1', saldoInicial: 18, queda: 14 })], kardex, p)[0].estado).toBe('NORMAL');
  });

  it('el registro diario sigue siendo el del libro: el inventario real no reescribe la planilla', () => {
    const kardex: KardexRow[] = [comida('2026-10-25T12:00:00Z', 30, 4, 'almuerzo')];
    const [d] = distribucionPorViver([viver({ saldoInicial: 16, queda: 12 })], kardex, p, new Map([['p1', 6]]));
    expect(d.filas[0]).toMatchObject({ invInicial: 16, salidas: 4, fisico: 12 });
  });
});

describe('stockDesdeContraste', () => {
  const lista = [viver({ producto_id: 'a', queda: 12 }), viver({ producto_id: 'b', queda: 3 })];

  it('toma el inventario de los que descuadran y el libro de los que cuadran', () => {
    const m = stockDesdeContraste(lista, [{ producto_id: 'a', inventario: 10 }], true);
    expect(m?.get('a')).toBe(10);
    expect(m?.get('b')).toBe(3);
  });

  it('sin inventario con que contrastar no inventa que el libro cuadra', () => {
    expect(stockDesdeContraste(lista, [], false)).toBeNull();
  });
});
