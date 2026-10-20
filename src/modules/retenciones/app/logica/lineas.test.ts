import { describe, expect, it } from 'vitest';
import { bloqueoPorFila, calcularDocumento, repartirBase, type EntradaDocumento, type LineaDocumento } from './lineas';
import type { ResultadoCalculo } from './motor';
import { ACTIVIDAD, COMISIONES_PNR, CONTEXTO, HONORARIOS_PNR, ISAE, ISLR_PNR, ISLR_PNR_FACTURA } from './reglasDePrueba';
import type { FilaClasificacion } from './regla';

const doc = (lineas: LineaDocumento[], over: Partial<EntradaDocumento> = {}): EntradaDocumento => ({
  moneda: 'Bs', tipo: 'factura', supuestos: [], lineas, ...over,
});
const montos = (r: { lineas: ResultadoCalculo[] }) => r.lineas.map((l) => (l.estado === 'calculado' ? l.monto : null));

describe('varias líneas por documento · el mínimo y el sustraendo por línea (lo de siempre)', () => {
  it('cada línea resta su sustraendo con su % y se compara con su propio mínimo', () => {
    const r = calcularDocumento(ISLR_PNR, doc([
      { montos: { subtotal: 50000 }, fila: HONORARIOS_PNR },
      { montos: { subtotal: 20000 }, fila: COMISIONES_PNR },
    ]), CONTEXTO);
    // 1.500 − 107,50 = 1.392,50; 1.000 − 5 % × 43 × 83,3334 (179,17) = 820,83
    expect(montos(r)).toEqual([1392.5, 820.83]);
    expect(r).toMatchObject({ estado: 'calculado', total: 2213.33 });
  });

  it('una línea por debajo de su mínimo no retiene; las demás sí', () => {
    const r = calcularDocumento(ISLR_PNR, doc([
      { montos: { subtotal: 50000 }, fila: HONORARIOS_PNR },
      { montos: { subtotal: 3000 }, fila: COMISIONES_PNR },
    ]), CONTEXTO);
    expect(montos(r)).toEqual([1392.5, 0]);
  });

  it('cada línea lleva su propia foto, con su fila', () => {
    const r = calcularDocumento(ISLR_PNR, doc([
      { montos: { subtotal: 50000 }, fila: HONORARIOS_PNR },
      { montos: { subtotal: 20000 }, fila: COMISIONES_PNR },
    ]), CONTEXTO);
    expect(r.lineas.map((l) => l.foto.valores.fila_id)).toEqual(['f-001', 'f-002']);
  });

  it('si a una línea le falta un dato, el total no se da por bueno', () => {
    const r = calcularDocumento(ISLR_PNR, doc([
      { montos: { subtotal: 50000 }, fila: HONORARIOS_PNR },
      { montos: { subtotal: 20000 }, fila: null },
    ]), CONTEXTO);
    expect(r).toMatchObject({ estado: 'sin_dato', total: 0 });
  });

  it('una nota de crédito con varias líneas resta en cada una y en el total', () => {
    const r = calcularDocumento(ISAE, doc([
      { montos: { subtotal: 10000, descuento: 0 }, fila: ACTIVIDAD },
      { montos: { subtotal: 20000, descuento: 0 }, fila: { ...ACTIVIDAD, id: 'f-a2', codigo: 'A-2', pct: 1 } },
    ], { tipo: 'nc' }), CONTEXTO);
    expect(montos(r)).toEqual([-250, -200]);
    expect(r.total).toBe(-450);
  });
});

describe('varias líneas por documento · el mínimo y el sustraendo «una vez por factura»', () => {
  it('el sustraendo, el de la primera línea, se descuenta una sola vez', () => {
    const r = calcularDocumento(ISLR_PNR_FACTURA, doc([
      { montos: { subtotal: 50000 }, fila: HONORARIOS_PNR },
      { montos: { subtotal: 20000 }, fila: COMISIONES_PNR },
    ]), CONTEXTO);
    expect(montos(r)).toEqual([1392.5, 1000]);
    expect(r.total).toBe(2392.5);
    const sus = r.lineas[1].foto.pasos.find((p) => p.paso === 'sustraendo');
    expect(sus?.nota).toBe('El sustraendo del documento se descontó en la línea 1.');
  });

  it('el mínimo se compara con la base del documento: dos líneas pequeñas que juntas lo pasan sí retienen', () => {
    // 2.000 + 2.000 = 4.000 ≥ 3.583,34. Sustraendo 107,50: la línea 1 (60) lo absorbe en parte y la 2 el resto (47,50).
    const r = calcularDocumento(ISLR_PNR_FACTURA, doc([
      { montos: { subtotal: 2000 }, fila: HONORARIOS_PNR },
      { montos: { subtotal: 2000 }, fila: COMISIONES_PNR },
    ]), CONTEXTO);
    expect(montos(r)).toEqual([0, 52.5]);
    // Por línea, ninguna llega a su mínimo
    expect(montos(calcularDocumento(ISLR_PNR, doc([
      { montos: { subtotal: 2000 }, fila: HONORARIOS_PNR },
      { montos: { subtotal: 2000 }, fila: COMISIONES_PNR },
    ]), CONTEXTO))).toEqual([0, 0]);
  });

  it('lo que sobra del sustraendo después de la última línea se pierde, y la foto lo dice', () => {
    // Una fila sin mínimo: 1.000 × 3 % = 30 y 1.000 × 5 % = 50; el sustraendo (107,50) se come las dos y sobran 27,50
    const sinMinimo = { ...HONORARIOS_PNR, minimo: null };
    const r = calcularDocumento(ISLR_PNR_FACTURA, doc([
      { montos: { subtotal: 1000 }, fila: sinMinimo },
      { montos: { subtotal: 1000 }, fila: { ...COMISIONES_PNR, minimo: null } },
    ]), CONTEXTO);
    expect(montos(r)).toEqual([0, 0]);
    const ultimo = r.lineas[1].foto.pasos[r.lineas[1].foto.pasos.length - 1];
    expect(ultimo).toMatchObject({ operacion: 'sobrante', nota: 'Quedaron 27,50 del sustraendo sin descontar: las líneas no alcanzan.' });
  });

  it('con una sola línea, «por línea» y «por factura» dan lo mismo, céntimo a céntimo', () => {
    const una = doc([{ montos: { subtotal: 20000.05 }, fila: COMISIONES_PNR }]);
    expect(calcularDocumento(ISLR_PNR, una, CONTEXTO).total).toBe(820.83);
    expect(calcularDocumento(ISLR_PNR_FACTURA, una, CONTEXTO).total).toBe(820.83);
    const exacto = { ...CONTEXTO, redondeoIntermedio: 'exacto' as const };
    expect(calcularDocumento(ISLR_PNR, una, exacto).total).toBe(820.84);
    expect(calcularDocumento(ISLR_PNR_FACTURA, una, exacto).total).toBe(820.84);
  });

  it('si la primera línea no tiene sustraendo, se toma el de la primera que lo tenga', () => {
    // Línea 1 sin factor: 50.000 × 3 % = 1.500; el sustraendo (107,50) sale de la línea 2 y lo absorbe la 1
    const r = calcularDocumento(ISLR_PNR_FACTURA, doc([
      { montos: { subtotal: 50000 }, fila: { ...HONORARIOS_PNR, id: 'f-sin', sustraendo_factor: null } },
      { montos: { subtotal: 50000 }, fila: HONORARIOS_PNR },
    ]), CONTEXTO);
    expect(montos(r)).toEqual([1392.5, 1500]);
  });

  it('si la base del documento no llega al mínimo, no retiene ninguna línea', () => {
    const r = calcularDocumento(ISLR_PNR_FACTURA, doc([
      { montos: { subtotal: 1000 }, fila: HONORARIOS_PNR },
      { montos: { subtotal: 1000 }, fila: COMISIONES_PNR },
    ]), CONTEXTO);
    expect(montos(r)).toEqual([0, 0]);
    expect(r.lineas[0]).toMatchObject({ nota: 'No se retiene: la base del documento no llega al mínimo.' });
  });

  it('con una línea sin fila, no se calcula el documento', () => {
    const r = calcularDocumento(ISLR_PNR_FACTURA, doc([
      { montos: { subtotal: 50000 }, fila: HONORARIOS_PNR },
      { montos: { subtotal: 20000 }, fila: null },
    ]), CONTEXTO);
    expect(r).toMatchObject({ estado: 'sin_dato', total: 0 });
  });
});

describe('un documento con bienes y servicios: la operación se decide por línea', () => {
  it('la línea de bienes no lleva la regla de servicios y no suma al total', () => {
    const servicios = { ...ISLR_PNR, operacion: 'servicios' as const };
    const r = calcularDocumento(servicios, doc([
      { montos: { subtotal: 50000 }, fila: HONORARIOS_PNR, operacion: 'servicios' },
      { montos: { subtotal: 80000 }, fila: HONORARIOS_PNR, operacion: 'bienes' },
    ]), CONTEXTO);
    expect(r.lineas.map((l) => l.estado)).toEqual(['calculado', 'no_aplica']);
    expect(r.total).toBe(1392.5);
  });
});

describe('repartir la base entre las líneas', () => {
  it('reparte por pesos y la última línea absorbe el redondeo', () => {
    expect(repartirBase(100, [1, 1, 1])).toEqual([33.33, 33.33, 33.34]);
    expect(repartirBase(1000, [60, 40])).toEqual([600, 400]);
  });

  it('sin pesos, todo en 0', () => {
    expect(repartirBase(100, [0, 0])).toEqual([0, 0]);
  });
});

describe('una regla que exige tabla no se registra sin una fila de esa tabla', () => {
  const filas = new Map<string, FilaClasificacion>([['A-1', ACTIVIDAD]]);

  it('un código de la tabla no bloquea', () => {
    expect(bloqueoPorFila('A-1', 'Actividades (ejemplo)', filas)).toEqual({ bloquea: false });
  });

  it('un código que no está en la tabla bloquea y dice por qué', () => {
    expect(bloqueoPorFila('Z-9', 'Actividades (ejemplo)', filas)).toEqual({
      bloquea: true, codigo: 'Z-9', motivo: 'No se registra: el código Z-9 no está en «Actividades (ejemplo)», y sin él no hay %.',
    });
  });

  it('sin código, queda por definir', () => {
    expect(bloqueoPorFila(null, 'Actividades (ejemplo)', filas)).toMatchObject({ bloquea: true, codigo: null });
  });
});
