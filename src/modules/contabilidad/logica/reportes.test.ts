import { describe, expect, it } from 'vitest';
import { estadoDePrueba } from '../pruebas/datosPrueba';
import {
  balanceComprobacion, balanceConEquivalente, diarioConEquivalente, formatoSaldo, libroDiario, mayorAnalitico, mayorConEquivalente,
  type FuenteInforme,
} from './reportes';

const e = estadoDePrueba();
const f: FuenteInforme = {
  comprobantes: e.cont_comprobantes, lineas: e.cont_comprobante_lineas, cuentas: e.cont_cuentas,
  centros: e.cont_centros_costo, auxiliares: e.cont_auxiliares,
};

describe('Diario de Comprobantes', () => {
  it('trae los contabilizados del rango, en orden, con total por comprobante y general', () => {
    const d = libroDiario(f, '2026-07-01', '2026-07-31', 'USD');
    expect(d.comprobantes.map((x) => x.comprobante.codigo)).toEqual(['07-000001', '07-000002']);
    expect(d.comprobantes[0]).toMatchObject({ debe: 25, haber: 25 });
    expect(d.comprobantes[0].asientos[0]).toMatchObject({ codigo: '6.2.01.01.001', nombre: 'COMISIONES BANCARIAS', debe: 25, haber: 0 });
    expect(d).toMatchObject({ debe: 50, haber: 50 });
  });

  it('el descuadrado no aparece (Galac: no entra en ningún informe)', () => {
    const d = libroDiario(f, '2026-10-01', '2026-10-31', 'USD');
    expect(d.comprobantes).toHaveLength(0);
  });

  it('en Bs, el renglón en bolívares sale por su monto', () => {
    const d = libroDiario(f, '2026-05-01', '2026-05-31', 'VES');
    expect(d.comprobantes[0].debe).toBe(23100);
  });
});

describe('Mayor Analítico', () => {
  it('Detallado: saldo inicial, movimientos con saldo corrido y totales', () => {
    const [caja] = mayorAnalitico(f, { desde: '2026-02-01', hasta: '2026-12-31', moneda: 'USD', modo: 'detallado', cuentaDesde: '1.1.01.01.002', cuentaHasta: '1.1.01.01.002' });
    expect(caja.cuenta.codigo).toBe('1.1.01.01.002');
    expect(caja.saldoInicial).toBe(5000);
    expect(caja.movimientos).toEqual([expect.objectContaining({ comprobante: '02-000002', debe: 0, haber: 1160, saldo: 3840 })]);
    expect(caja).toMatchObject({ debe: 0, haber: 1160, saldoFinal: 3840 });
  });

  it('Resumido: un renglón por mes con «MOVIMIENTOS DEL MES»', () => {
    const [divisas] = mayorAnalitico(f, { desde: '2026-01-01', hasta: '2026-12-31', moneda: 'USD', modo: 'resumido', cuentaDesde: '1.1.01.03.001', cuentaHasta: '1.1.01.03.001' });
    expect(divisas.movimientos.map((m) => [m.comprobante, m.descripcion, m.debe, m.saldo])).toEqual([
      ['MOVIMIENTOS DEL MES', 'ENERO 2026', 15000, 15000],
      ['MOVIMIENTOS DEL MES', 'MARZO 2026', 8000, 23000],
    ]);
  });

  it('sin movimiento en el rango, una cuenta con saldo aparece solo si se pide', () => {
    const filtro = { desde: '2026-08-01', hasta: '2026-12-31', moneda: 'USD' as const, modo: 'detallado' as const, cuentaDesde: '1.2.01.01.003', cuentaHasta: '1.2.01.01.003' };
    expect(mayorAnalitico(f, filtro)).toHaveLength(0);
    const [maq] = mayorAnalitico(f, { ...filtro, incluirSinMovimiento: true });
    expect(maq).toMatchObject({ saldoInicial: 30000, saldoFinal: 30000, movimientos: [] });
  });
});

describe('Balance de Comprobación', () => {
  const b = balanceComprobacion(f, { desde: '2026-01-01', hasta: '2026-12-31', moneda: 'USD', nivel: 5 });

  it('TOTALES: Debe = Haber y saldos en cero', () => {
    expect(b.totales.debe).toBe(b.totales.haber);
    expect(b.totales.saldoActual).toBe(0);
    expect(b.totales.saldoInicial).toBe(0);
  });

  it('cada título totaliza a sus subcuentas', () => {
    const fila = (c: string) => b.filas.find((x) => x.cuenta.codigo === c)!;
    expect(fila('1.1.01').saldoActual).toBeCloseTo(fila('1.1.01.01').saldoActual + fila('1.1.01.03').saldoActual + (b.filas.find((x) => x.cuenta.codigo === '1.1.01.02')?.saldoActual ?? 0), 2);
    expect(fila('1.1.01.03.001').saldoActual).toBe(23000);
    const grupos = ['1', '2', '3', '4', '5', '6'].map((c) => b.filas.find((x) => x.cuenta.codigo === c)?.saldoActual ?? 0);
    expect(grupos.reduce((a, x) => a + x, 0)).toBeCloseTo(0, 2);
  });

  it('el nivel de detalle corta las cuentas; sin movimiento se ocultan salvo que se pidan', () => {
    const n1 = balanceComprobacion(f, { desde: '2026-01-01', hasta: '2026-12-31', moneda: 'USD', nivel: 1 });
    expect(n1.filas.map((x) => x.cuenta.codigo)).toEqual(['1', '2', '3', '4', '6']); // costos sin movimiento
    const todas = balanceComprobacion(f, { desde: '2026-01-01', hasta: '2026-12-31', moneda: 'USD', nivel: 1, incluirSinMovimiento: true });
    expect(todas.filas.map((x) => x.cuenta.codigo)).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('el saldo inicial es lo anterior al rango', () => {
    const desdeFeb = balanceComprobacion(f, { desde: '2026-02-01', hasta: '2026-12-31', moneda: 'USD', nivel: 1 });
    const pasivo = desdeFeb.filas.find((x) => x.cuenta.codigo === '3')!;
    expect(pasivo.saldoInicial).toBe(-50000);
    expect(pasivo.debe).toBe(0);
  });

  it('los saldos acreedores van entre paréntesis', () => {
    expect(formatoSaldo(-1234.5, (v) => v.toFixed(2))).toBe('(1234.50)');
    expect(formatoSaldo(10, (v) => v.toFixed(2))).toBe('10.00');
  });
});

describe('la moneda equivalente (una columna por importe, la otra moneda debajo)', () => {
  it('el diario lleva en cada asiento, comprobante y total lo mismo en la otra moneda', () => {
    const d = diarioConEquivalente(libroDiario(f, '2026-05-01', '2026-05-31', 'VES'), libroDiario(f, '2026-05-01', '2026-05-31', 'USD'));
    const usd = libroDiario(f, '2026-05-01', '2026-05-31', 'USD');
    expect(d.comprobantes[0].debe).toBe(23100);
    expect(d.comprobantes[0].eq).toEqual({ debe: usd.comprobantes[0].debe, haber: usd.comprobantes[0].haber });
    expect(d.comprobantes[0].asientos.map((a) => a.eq)).toEqual(usd.comprobantes[0].asientos.map((a) => ({ debe: a.debe, haber: a.haber })));
    expect(d.eq).toEqual({ debe: usd.debe, haber: usd.haber });
  });

  it('el mayor empareja por cuenta y por movimiento', () => {
    const filtro = { desde: '2026-02-01', hasta: '2026-12-31', modo: 'detallado' as const, cuentaDesde: '1.1.01.01.002', cuentaHasta: '1.1.01.01.002' };
    const [caja] = mayorConEquivalente(mayorAnalitico(f, { ...filtro, moneda: 'USD' }), mayorAnalitico(f, { ...filtro, moneda: 'VES' }));
    const [enBs] = mayorAnalitico(f, { ...filtro, moneda: 'VES' });
    expect(caja.saldoInicial).toBe(5000);
    expect(caja.eq).toEqual({ saldoInicial: enBs.saldoInicial, debe: enBs.debe, haber: enBs.haber, saldoFinal: enBs.saldoFinal });
    expect(caja.movimientos[0].eq).toEqual({ debe: enBs.movimientos[0].debe, haber: enBs.movimientos[0].haber, saldo: enBs.movimientos[0].saldo });
  });

  it('el balance empareja por cuenta; la que falta en la otra moneda vale cero allí', () => {
    const filtro = { desde: '2026-01-01', hasta: '2026-12-31', nivel: 5 };
    const p = balanceComprobacion(f, { ...filtro, moneda: 'USD' });
    const o = balanceComprobacion(f, { ...filtro, moneda: 'VES' });
    const b = balanceConEquivalente(p, { ...o, filas: o.filas.slice(1) });
    expect(b.filas[0].eq).toEqual({ saldoInicial: 0, debe: 0, haber: 0, saldoActual: 0 });
    const x = o.filas[1];
    expect(b.filas.find((y) => y.cuenta.id === x.cuenta.id)?.eq).toEqual({ saldoInicial: x.saldoInicial, debe: x.debe, haber: x.haber, saldoActual: x.saldoActual });
    expect(b.totales.eq).toEqual(o.totales);
  });
});
