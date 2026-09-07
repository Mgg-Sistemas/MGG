import { describe, it, expect } from 'vitest';
import {
  calcularPisoFundicion, soloConSaldo, disponibleDe, motivoNoAlcanza,
  type EntregaFundicion,
} from './pisoFundicion';

const COQUE = 'p-coque';
const CAL = 'p-cal';

const entrega = (p: Partial<EntregaFundicion> = {}): EntregaFundicion => ({
  producto_id: COQUE, producto_nombre: 'CARBON COQUE 25-50MM', unidad: 'GRAMO',
  cantidad: 900, precio_unit: 2, codigo: 'SAL-2026-0123', fecha: '2026-09-05', ...p,
});

describe('el piso de fundición', () => {
  it('lo entregado y no fundido queda disponible', () => {
    const piso = calcularPisoFundicion([entrega()], [], []);
    expect(piso[0]).toMatchObject({ entregado: 900, fundido: 0, devuelto: 0, disponible: 900 });
  });

  it('lo que quema una colada baja el disponible, sin tocar el inventario', () => {
    // El caso del planteo: salen 900 g de coque y la fundición solo puede usar esos.
    const piso = calcularPisoFundicion([entrega()], [{ producto_id: COQUE, cantidad: 400 }], []);
    expect(disponibleDe(piso, COQUE)).toBe(500);
  });

  it('lo devuelto al inventario también baja el disponible', () => {
    const piso = calcularPisoFundicion(
      [entrega()], [{ producto_id: COQUE, cantidad: 400 }], [{ producto_id: COQUE, cantidad: 500 }],
    );
    expect(disponibleDe(piso, COQUE)).toBe(0);
  });

  it('una devolución cargada en negativo cuenta igual', () => {
    // El movimiento de entrada puede llegar con el delta en positivo o negativo
    // según de dónde se lea; el piso no puede depender del signo.
    const piso = calcularPisoFundicion([entrega()], [], [{ producto_id: COQUE, cantidad: -200 }]);
    expect(disponibleDe(piso, COQUE)).toBe(700);
  });

  it('varias entregas del mismo material se suman', () => {
    const piso = calcularPisoFundicion(
      [entrega({ cantidad: 900 }), entrega({ cantidad: 600, codigo: 'SAL-2026-0140', fecha: '2026-09-06' })],
      [], [],
    );
    expect(piso[0].entregado).toBe(1500);
    expect(piso[0].entregas.map((e) => e.codigo)).toEqual(['SAL-2026-0123', 'SAL-2026-0140']);
  });

  it('las entregas se ordenan de la más vieja a la más nueva', () => {
    const piso = calcularPisoFundicion(
      [entrega({ fecha: '2026-09-20', codigo: 'B' }), entrega({ fecha: '2026-09-01', codigo: 'A' })], [], [],
    );
    expect(piso[0].entregas.map((e) => e.codigo)).toEqual(['A', 'B']);
  });

  it('nunca queda en negativo', () => {
    // Si un consumo viejo quedó mal atribuido, el piso muestra 0 — no bloquea
    // la operación con un saldo en rojo.
    const piso = calcularPisoFundicion([entrega({ cantidad: 100 })], [{ producto_id: COQUE, cantidad: 500 }], []);
    expect(piso[0].disponible).toBe(0);
    expect(piso[0].fundido).toBe(500);   // pero el dato real se sigue viendo
  });

  it('un material fundido sin entrega no inventa disponible', () => {
    const piso = calcularPisoFundicion([], [{ producto_id: CAL, cantidad: 50 }], []);
    expect(disponibleDe(piso, CAL)).toBe(0);
  });

  it('separa un material de otro', () => {
    const piso = calcularPisoFundicion(
      [entrega(), entrega({ producto_id: CAL, producto_nombre: 'CARBONATO DE CALCIO M6', cantidad: 1200 })],
      [{ producto_id: COQUE, cantidad: 900 }], [],
    );
    expect(disponibleDe(piso, COQUE)).toBe(0);
    expect(disponibleDe(piso, CAL)).toBe(1200);
  });

  it('«soloConSaldo» deja fuera lo que ya se quemó entero', () => {
    const piso = calcularPisoFundicion(
      [entrega(), entrega({ producto_id: CAL, producto_nombre: 'CAL', cantidad: 100 })],
      [{ producto_id: COQUE, cantidad: 900 }], [],
    );
    expect(piso).toHaveLength(2);                       // en la vista se ven los dos
    expect(soloConSaldo(piso).map((f) => f.producto_id)).toEqual([CAL]);
  });
});

describe('el costo con el que entra a la colada', () => {
  it('es el de la entrega, no el PMP de hoy', () => {
    const piso = calcularPisoFundicion([entrega({ precio_unit: 2 })], [], []);
    expect(piso[0].costo_unitario).toBe(2);
  });

  it('con varias entregas a distinto precio, pondera por cantidad', () => {
    const piso = calcularPisoFundicion([
      entrega({ cantidad: 100, precio_unit: 1 }),
      entrega({ cantidad: 300, precio_unit: 5 }),
    ], [], []);
    expect(piso[0].costo_unitario).toBe(4);   // (100×1 + 300×5) / 400
  });

  it('las entregas sin precio no arrastran el promedio a cero', () => {
    const piso = calcularPisoFundicion([
      entrega({ cantidad: 100, precio_unit: 3 }),
      entrega({ cantidad: 100, precio_unit: null }),
    ], [], []);
    expect(piso[0].costo_unitario).toBe(3);
  });

  it('sin ningún precio da 0, no NaN', () => {
    const piso = calcularPisoFundicion([entrega({ precio_unit: null })], [], []);
    expect(piso[0].costo_unitario).toBe(0);
  });
});

describe('el tope al cargar una colada', () => {
  const piso = calcularPisoFundicion([entrega()], [], []);

  it('deja pasar lo que alcanza', () => {
    expect(motivoNoAlcanza(piso, COQUE, 900, 'GRAMO')).toBeNull();
  });

  it('explica cuánto hay cuando se pide de más', () => {
    expect(motivoNoAlcanza(piso, COQUE, 901, 'GRAMO')).toBe('Solo hay 900 GRAMO entregados a fundición.');
  });

  it('dice qué hacer si nunca se entregó ese material', () => {
    expect(motivoNoAlcanza(piso, CAL, 1)).toMatch(/Sacalo por Salidas/);
  });

  it('rechaza cantidades vacías o negativas', () => {
    expect(motivoNoAlcanza(piso, COQUE, 0)).toMatch(/mayor que 0/);
    expect(motivoNoAlcanza(piso, COQUE, -5)).toMatch(/mayor que 0/);
  });
});

describe('bordes', () => {
  it('sin nada devuelve una lista vacía', () => {
    expect(calcularPisoFundicion([], [], [])).toEqual([]);
    expect(disponibleDe([], 'x')).toBe(0);
  });

  it('ignora líneas sin producto o en cero', () => {
    const piso = calcularPisoFundicion(
      [entrega({ producto_id: '' }), entrega({ cantidad: 0 }), entrega({ cantidad: 10 })], [], [],
    );
    expect(piso).toHaveLength(1);
    expect(piso[0].entregado).toBe(10);
  });

  it('tolera cantidades no numéricas sin romper el total', () => {
    const piso = calcularPisoFundicion(
      [entrega({ cantidad: 'abc' as unknown as number }), entrega({ cantidad: 50 })], [], [],
    );
    expect(piso[0].entregado).toBe(50);
  });
});
