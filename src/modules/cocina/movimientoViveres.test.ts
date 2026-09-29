import { describe, it, expect } from 'vitest';
import {
  movimientoDeViveres, totalesDeViveres, salidasDeInventario, esDeCocina, esTraslado,
  kardexDetallado, ETIQUETA_CLASE,
  type FichaViver, type MovimientoViver,
} from './movimientoViveres';

const ARROZ: FichaViver = { id: 'p1', sku: 'VIV-057', nombre: 'ARROZ', unidad: 'UNIDAD', precio: 2 };
const POLLO: FichaViver = { id: 'p2', sku: 'POT-001', nombre: 'POLLO', unidad: 'KILOGRAMO', precio: 5 };

const DESDE = '2026-09-01T00:00:00.000Z';
const HASTA = '2026-09-30T23:59:59.000Z';

function mov(p: Partial<MovimientoViver> & { producto_id: string; at: string; delta: number }): MovimientoViver {
  return { tipo: 'salida', ref_tipo: 'manual', ...p };
}

describe('movimientoDeViveres', () => {
  it('reconstruye lo que HABÍA caminando el kardex hacia atrás desde el stock de hoy', () => {
    // Hoy quedan 10. En el período entraron 30 y se comieron 40 → había 20.
    const filas = movimientoDeViveres(
      [ARROZ], new Map([['p1', 10]]),
      [
        mov({ producto_id: 'p1', at: '2026-09-05T10:00:00Z', delta: 30, tipo: 'entrada' }),
        mov({ producto_id: 'p1', at: '2026-09-10T10:00:00Z', delta: -40, ref_tipo: 'cocina' }),
      ],
      DESDE, HASTA,
    );
    expect(filas).toHaveLength(1);
    expect(filas[0].habia).toBe(20);
    expect(filas[0].entradas).toBe(30);
    expect(filas[0].consumido).toBe(40);
    expect(filas[0].queda).toBe(10);
  });

  it('el renglón CIERRA: había + entradas + traslados − consumido − salidas = queda', () => {
    const filas = movimientoDeViveres(
      [ARROZ], new Map([['p1', 7]]),
      [
        mov({ producto_id: 'p1', at: '2026-09-02T10:00:00Z', delta: 50, tipo: 'entrada' }),
        mov({ producto_id: 'p1', at: '2026-09-03T10:00:00Z', delta: 12, tipo: 'transferencia' }),
        mov({ producto_id: 'p1', at: '2026-09-11T10:00:00Z', delta: -40, ref_tipo: 'cocina' }),
        mov({ producto_id: 'p1', at: '2026-09-12T10:00:00Z', delta: -9, tipo: 'ajuste' }),
      ],
      DESDE, HASTA,
    );
    const f = filas[0];
    expect(f.habia + f.entradas + f.traslados - f.consumido - f.salidas).toBe(f.queda);
  });

  it('separa el consumo de las comidas de las salidas y ajustes de inventario', () => {
    const filas = movimientoDeViveres(
      [ARROZ], new Map([['p1', 0]]),
      [
        mov({ producto_id: 'p1', at: '2026-09-10T10:00:00Z', delta: -6, ref_tipo: 'cocina' }),
        mov({ producto_id: 'p1', at: '2026-09-12T10:00:00Z', delta: -4, tipo: 'ajuste', detalle: 'Conteo físico', actor_name: 'ERICK' }),
      ],
      DESDE, HASTA,
    );
    expect(filas[0].consumido).toBe(6);
    expect(filas[0].salidas).toBe(4);
    expect(filas[0].detalleSalidas).toHaveLength(1);
    expect(filas[0].detalleSalidas[0]).toMatchObject({ cantidad: 4, tipo: 'ajuste', motivo: 'Conteo físico', actor: 'ERICK' });
  });

  it('el reverso de una comida borrada RESTA del consumo, no suma entradas', () => {
    const filas = movimientoDeViveres(
      [ARROZ], new Map([['p1', 4]]),
      [
        mov({ producto_id: 'p1', at: '2026-09-10T10:00:00Z', delta: -10, ref_tipo: 'cocina' }),
        mov({ producto_id: 'p1', at: '2026-09-11T10:00:00Z', delta: 6, tipo: 'entrada', ref_tipo: 'cocina', detalle: 'Reverso por eliminación' }),
      ],
      DESDE, HASTA,
    );
    expect(filas[0].consumido).toBe(4);
    expect(filas[0].entradas).toBe(0);
  });

  it('un movimiento POSTERIOR al período corre el saldo pero no entra en las columnas', () => {
    // Hoy hay 2, pero el 05/10 (fuera) salieron 8: al cerrar septiembre quedaban 10.
    const filas = movimientoDeViveres(
      [ARROZ], new Map([['p1', 2]]),
      [
        mov({ producto_id: 'p1', at: '2026-09-10T10:00:00Z', delta: -5, ref_tipo: 'cocina' }),
        mov({ producto_id: 'p1', at: '2026-10-05T10:00:00Z', delta: -8, tipo: 'ajuste' }),
      ],
      DESDE, HASTA,
    );
    expect(filas[0].queda).toBe(10);
    expect(filas[0].habia).toBe(15);
    expect(filas[0].salidas).toBe(0);      // el ajuste de octubre no es de este período
    expect(filas[0].consumido).toBe(5);
  });

  it('ignora lo anterior al período: el víver queda quieto, con había = queda', () => {
    const filas = movimientoDeViveres(
      [ARROZ], new Map([['p1', 3]]),
      [mov({ producto_id: 'p1', at: '2026-08-20T10:00:00Z', delta: -99, ref_tipo: 'cocina' })],
      DESDE, HASTA,
    );
    // El consumo de agosto no cuenta en septiembre, pero el víver SÍ se lista:
    // «lo que había y lo que queda» también vale para lo que no se tocó.
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ habia: 3, queda: 3, consumido: 0, salidas: 0, entradas: 0 });
  });

  it('usa el delta EFECTIVO: una salida de más queda topada en lo que había', () => {
    // Pidió 101,5 y el almacén tenía 24: bajó 24, no 101,5.
    const filas = movimientoDeViveres(
      [ARROZ], new Map([['p1', 0]]),
      [mov({ producto_id: 'p1', at: '2026-09-10T10:00:00Z', delta: -101.5, stock_antes: 24, stock_despues: 0, tipo: 'ajuste' })],
      DESDE, HASTA,
    );
    expect(filas[0].salidas).toBe(24);
    expect(filas[0].habia).toBe(24);
    expect(filas[0].queda).toBe(0);
  });

  it('no lista el víver que ni tiene stock ni se movió: sería una fila de ceros', () => {
    const filas = movimientoDeViveres(
      [ARROZ, POLLO], new Map([['p1', 5]]),   // POLLO sin stock y sin movimientos
      [mov({ producto_id: 'p1', at: '2026-09-10T10:00:00Z', delta: -1, ref_tipo: 'cocina' })],
      DESDE, HASTA,
    );
    expect(filas.map((f) => f.sku)).toEqual(['VIV-057']);
  });

  it('descarta movimientos de productos que no son víveres de cocina', () => {
    const filas = movimientoDeViveres(
      [ARROZ], new Map([['p1', 5]]),
      [mov({ producto_id: 'otro', at: '2026-09-10T10:00:00Z', delta: -50, ref_tipo: 'cocina' })],
      DESDE, HASTA,
    );
    // El movimiento ajeno no mueve nada; el arroz se lista con su stock quieto.
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ sku: 'VIV-057', habia: 5, queda: 5, consumido: 0 });
  });

  it('ordena por lo más consumido', () => {
    const filas = movimientoDeViveres(
      [ARROZ, POLLO], new Map([['p1', 0], ['p2', 0]]),
      [
        mov({ producto_id: 'p1', at: '2026-09-10T10:00:00Z', delta: -2, ref_tipo: 'cocina' }),
        mov({ producto_id: 'p2', at: '2026-09-10T10:00:00Z', delta: -30, ref_tipo: 'cocina' }),
      ],
      DESDE, HASTA,
    );
    expect(filas.map((f) => f.sku)).toEqual(['POT-001', 'VIV-057']);
  });
});

describe('totalesDeViveres', () => {
  it('el pie también cuadra y cuenta los víveres en cero', () => {
    const filas = movimientoDeViveres(
      [ARROZ, POLLO], new Map([['p1', 0], ['p2', 6]]),
      [
        mov({ producto_id: 'p1', at: '2026-09-10T10:00:00Z', delta: -10, ref_tipo: 'cocina' }),
        mov({ producto_id: 'p1', at: '2026-09-12T10:00:00Z', delta: -3, tipo: 'ajuste', detalle: 'Pérdida' }),
        mov({ producto_id: 'p2', at: '2026-09-11T10:00:00Z', delta: 6, tipo: 'entrada' }),
      ],
      DESDE, HASTA,
    );
    const t = totalesDeViveres(filas);
    expect(t.habia + t.entradas + t.traslados - t.consumido - t.salidas).toBe(t.queda);
    expect(t.consumido).toBe(10);
    expect(t.salidas).toBe(3);
    expect(t.conSalidas).toBe(1);
    expect(t.enCero).toBe(1);
  });

  it('sin filas da todo en cero', () => {
    const t = totalesDeViveres([]);
    expect(t).toMatchObject({ habia: 0, consumido: 0, salidas: 0, queda: 0, conSalidas: 0, enCero: 0 });
  });
});

describe('salidasDeInventario', () => {
  it('junta todas las salidas con el nombre del víver, de la más nueva a la más vieja', () => {
    const filas = movimientoDeViveres(
      [ARROZ, POLLO], new Map([['p1', 0], ['p2', 0]]),
      [
        mov({ producto_id: 'p1', at: '2026-09-05T10:00:00Z', delta: -1, tipo: 'ajuste', detalle: 'Vieja' }),
        mov({ producto_id: 'p2', at: '2026-09-20T10:00:00Z', delta: -2, tipo: 'salida', detalle: 'Nueva' }),
      ],
      DESDE, HASTA,
    );
    const s = salidasDeInventario(filas);
    expect(s.map((x) => x.motivo)).toEqual(['Nueva', 'Vieja']);
    expect(s[0].nombre).toBe('POLLO');
    expect(s[0].unidad).toBe('KILOGRAMO');
  });
});

describe('clasificadores', () => {
  it('reconoce cocina por ref_tipo, no por el texto', () => {
    expect(esDeCocina({ ref_tipo: 'cocina' })).toBe(true);
    expect(esDeCocina({ ref_tipo: 'manual' })).toBe(false);
    expect(esDeCocina({ ref_tipo: null })).toBe(false);
  });
  it('reconoce el traslado por tipo', () => {
    expect(esTraslado({ tipo: 'transferencia' })).toBe(true);
    expect(esTraslado({ tipo: 'salida' })).toBe(false);
  });
});

describe('kardexDetallado', () => {
  const FILAS = () => movimientoDeViveres(
    [ARROZ, POLLO], new Map([['p1', 0], ['p2', 0]]),
    [
      mov({ producto_id: 'p2', at: '2026-09-20T10:00:00Z', delta: -2, tipo: 'salida', detalle: 'Pérdida' }),
      mov({ producto_id: 'p1', at: '2026-09-05T10:00:00Z', delta: 10, tipo: 'entrada', detalle: 'Compra' }),
      mov({ producto_id: 'p1', at: '2026-09-08T10:00:00Z', delta: -4, ref_tipo: 'cocina' }),
      mov({ producto_id: 'p1', at: '2026-09-09T10:00:00Z', delta: -6, tipo: 'transferencia' }),
    ],
    DESDE, HASTA,
  );

  it('agrupa por víver y dentro de cada uno va de lo más viejo a lo más nuevo', () => {
    const k = kardexDetallado(FILAS());
    expect(k.map((r) => `${r.sku}:${r.at.slice(8, 10)}`)).toEqual([
      'VIV-057:05', 'VIV-057:08', 'VIV-057:09', 'POT-001:20',
    ]);
  });

  it('clasifica cada renglón', () => {
    const k = kardexDetallado(FILAS());
    expect(k.map((r) => r.clase)).toEqual(['entrada', 'comida', 'traslado', 'salida']);
  });

  it('acota a las clases pedidas', () => {
    const k = kardexDetallado(FILAS(), ['salida', 'comida']);
    expect(k.map((r) => r.clase)).toEqual(['comida', 'salida']);
  });

  it('cada renglón trae el víver y su unidad, para poder leerlo suelto', () => {
    const k = kardexDetallado(FILAS(), ['salida']);
    expect(k[0]).toMatchObject({ nombre: 'POLLO', sku: 'POT-001', unidad: 'KILOGRAMO', delta: -2, motivo: 'Pérdida' });
  });

  it('cada fila guarda TODOS sus movimientos, no solo las salidas', () => {
    const arroz = FILAS().find((f) => f.sku === 'VIV-057')!;
    expect(arroz.movimientos).toHaveLength(3);
    expect(arroz.detalleSalidas).toHaveLength(0);
  });
});

describe('ETIQUETA_CLASE', () => {
  it('nombra las cuatro clases en español', () => {
    expect(ETIQUETA_CLASE.entrada).toBe('Entrada');
    expect(ETIQUETA_CLASE.comida).toBe('Comida');
    expect(ETIQUETA_CLASE.salida).toBe('Salida / ajuste');
    expect(ETIQUETA_CLASE.traslado).toBe('Traslado');
  });
});
