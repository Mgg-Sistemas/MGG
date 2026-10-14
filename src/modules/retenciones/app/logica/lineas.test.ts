import { describe, expect, it } from 'vitest';
import { bloqueoActividad, calcularLineas, repartirBase } from './lineas';
import type { ActividadVigente, ContextoRegla, EntradaRegla, PiezasRegla } from './regla';

const ISLR: PiezasRegla = { base: 'porcion', pct: 'concepto', sustraendo: 'formula', factor: 83.3334, minimo: 'ut', condicion: 'ninguna', moneda: 'cualquiera', redondeo: 'paso', cuenta: 'retencion' };
const ISAE: PiezasRegla = { base: 'sin_iva', pct: 'actividad', sustraendo: 'ninguno', minimo: 'ninguno', condicion: 'ninguna', moneda: 'cualquiera', redondeo: 'paso', cuenta: 'retencion' };
const ctx: ContextoRegla = { ut: 43, pctGeneral: 75, pctArt5: 100, agenteIva: true, especial: true };
const factura: EntradaRegla = { fecha: '2026-10-14', base: 0, iva: 0, pagado: 0, moneda: 'Bs', motivos100: null, concepto: null, actividad: null };
// Conceptos y actividades ficticios
const honorarios = { codigo: '002', nombre: 'Honorarios (ejemplo)', porcentaje: 3, basePct: 100, minimoUt: 83.3334, aplicaSustraendo: true };
const comisiones = { codigo: '004', nombre: 'Comisiones (ejemplo)', porcentaje: 5, basePct: 100, minimoUt: 83.3334, aplicaSustraendo: true };
const act = (codigo: string, porcentaje: number): ActividadVigente => ({ codigo, descripcion: `Actividad ${codigo} (ejemplo)`, porcentaje, sujeta: true });

describe('varias líneas por factura · ISLR por concepto', () => {
  it('por concepto (el valor por defecto): cada línea resta su sustraendo con su % y se compara con su mínimo', () => {
    const r = calcularLineas(ISLR, factura, [{ base: 50000, concepto: honorarios }, { base: 20000, concepto: comisiones }], ctx);
    // 50.000 × 3 % − (3 % × 43 × 83,3334 = 107,50) = 1.392,50
    // 20.000 × 5 % − (5 % × 43 × 83,3334 = 179,17) = 820,83
    expect(r.lineas.map((l) => l.monto)).toEqual([1392.5, 820.83]);
    expect(r.total).toBe(2213.33);
    expect(r.estado).toBe('calculado');
  });

  it('por concepto: una línea por debajo de su mínimo no retiene, las demás sí', () => {
    const r = calcularLineas(ISLR, factura, [{ base: 50000, concepto: honorarios }, { base: 3000, concepto: comisiones }], ctx);
    expect(r.lineas.map((l) => l.monto)).toEqual([1392.5, 0]);
    expect(r.lineas[1].nota).toBe('No se retiene: la base no llega al mínimo.');
    expect(r.total).toBe(1392.5);
  });

  it('una vez por factura: el mínimo con la base total y un solo sustraendo, el de la primera línea', () => {
    const r = calcularLineas(ISLR, factura, [{ base: 50000, concepto: honorarios }, { base: 3000, concepto: comisiones }], ctx, { modoSustraendo: 'factura' });
    // 50.000 × 3 % + 3.000 × 5 % = 1.650; menos el sustraendo de la primera línea (107,50) = 1.542,50
    expect(r.lineas.map((l) => l.monto)).toEqual([1392.5, 150]);
    expect(r.total).toBe(1542.5);
  });

  it('una vez por factura: si la base total no llega al mínimo, no retiene ninguna línea', () => {
    const r = calcularLineas(ISLR, factura, [{ base: 1000, concepto: honorarios }, { base: 1000, concepto: comisiones }], ctx, { modoSustraendo: 'factura' });
    expect(r.total).toBe(0);
    expect(r.lineas.every((l) => l.monto === 0)).toBe(true);
  });

  it('si a una línea le falta un dato, el total no se da por bueno', () => {
    const r = calcularLineas(ISLR, factura, [{ base: 50000, concepto: honorarios }, { base: 1000, concepto: null }], ctx);
    expect(r.estado).toBe('sin_dato');
    expect(r.lineas[1].falta).toBe('concepto');
  });
});

describe('varias líneas por factura · ISAE por actividad', () => {
  it('una línea por actividad, cada una con su alícuota', () => {
    const r = calcularLineas(ISAE, factura, [{ base: 6000, actividad: act('3.3.29', 2.5) }, { base: 4000, actividad: act('3.1.11', 1) }], ctx);
    expect(r.lineas.map((l) => [l.clave, l.porcentaje, l.monto])).toEqual([['3.3.29', 2.5, 150], ['3.1.11', 1, 40]]);
    expect(r.total).toBe(190);
  });
});

describe('repartir la base entre las líneas', () => {
  it('reparte por pesos y la última línea absorbe el redondeo', () => {
    expect(repartirBase(1000, [60, 40])).toEqual([600, 400]);
    const tres = repartirBase(100, [1, 1, 1]);
    expect(tres).toEqual([33.33, 33.33, 33.34]);
    expect(tres.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 10);
  });
});

describe('la actividad del ISAE fuera del catálogo: no se registra', () => {
  const catalogo = new Map([['3.3.29', act('3.3.29', 2.5)]]);

  it('una actividad del catálogo no bloquea', () => {
    expect(bloqueoActividad('3.3.29', catalogo)).toEqual({ bloquea: false });
  });

  it('una actividad que no está en el catálogo bloquea y dice por qué', () => {
    expect(bloqueoActividad('3.3.41', catalogo)).toEqual({
      bloquea: true, codigo: '3.3.41',
      motivo: 'No se registra: la actividad 3.3.41 del proveedor no está en el catálogo de actividades del ISAE, y sin ella no hay alícuota.',
    });
  });

  it('sin actividad, queda por definir', () => {
    expect(bloqueoActividad(null, catalogo)).toEqual({ bloquea: true, codigo: null, motivo: 'Por definir: falta la actividad del ISAE del proveedor.' });
  });
});
