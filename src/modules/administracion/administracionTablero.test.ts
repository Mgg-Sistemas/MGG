import { describe, expect, it } from 'vitest';
import { barrasEmpresa, donutCategoria, kpisTablero, type GastoTablero } from './administracionTablero';

const g = (p: Partial<GastoTablero>): GastoTablero => ({
  empresaClave: 'GT', concepto: 'Gasto', empresaNombre: 'Golden Touch', categoria: 'Servicios', monto: 100, moneda: 'USD',
  periodicidad: 'mensual', diaVencimiento: 10, vigenteDesde: '2020-01-01', estado: 'activo', ...p,
});
const hoy = new Date(2026, 10, 1); // 2026-11-01

describe('kpisTablero', () => {
  it('gasto/mes normaliza por período y convierte a tasa', () => {
    const gastos = [
      g({ monto: 100, moneda: 'USD', periodicidad: 'mensual' }),   // 100/mes
      g({ monto: 1200, moneda: 'USD', periodicidad: 'anual' }),    // 100/mes
      g({ monto: 400, moneda: 'Bs', periodicidad: 'mensual' }),    // 400 Bs/mes
    ];
    const k = kpisTablero(gastos, 40, hoy);
    expect(k.gastoMes.usd).toBe(200);
    expect(k.gastoMes.bs).toBe(400);
    expect(k.gastoMes.equivUsd).toBe(210); // 200 + 400/40
    expect(k.activos).toEqual({ activos: 3, total: 3 });
  });

  it('cuenta los que vencen en ≤7 días y los de este mes; ignora suspendidos', () => {
    const gastos = [
      g({ diaVencimiento: 5, monto: 50 }),   // vence 2026-11-05 → dentro de 7 días y este mes
      g({ diaVencimiento: 20, monto: 80 }),  // vence 2026-11-20 → este mes, no ≤7
      g({ estado: 'suspendido', diaVencimiento: 3, monto: 999 }), // ignorado
    ];
    const k = kpisTablero(gastos, 40, hoy);
    expect(k.venceEn.n).toBe(1);
    expect(k.venceEn.equivUsd).toBe(50);
    expect(k.esteMes.n).toBe(2);
    expect(k.esteMes.equivUsd).toBe(130);
    expect(k.activos).toEqual({ activos: 2, total: 3 });
  });
});

describe('gráficos', () => {
  const gastos = [
    g({ categoria: 'Alquiler', empresaNombre: 'Golden Touch', monto: 300, moneda: 'USD', periodicidad: 'mensual' }),
    g({ categoria: 'Servicios', empresaNombre: 'Golden Touch', monto: 100, moneda: 'USD', periodicidad: 'mensual' }),
    g({ categoria: 'Alquiler', empresaNombre: 'Minera Demo', monto: 100, moneda: 'USD', periodicidad: 'mensual' }),
  ];
  it('donut por categoría, con % que suma ~100', () => {
    const d = donutCategoria(gastos, 40);
    expect(d[0].clave).toBe('Alquiler'); // 400 de 500
    expect(d[0].pct).toBe(80);
    expect(Math.round(d.reduce((s, x) => s + x.pct, 0))).toBe(100);
  });
  it('barras por empresa, de mayor a menor', () => {
    const b = barrasEmpresa(gastos, 40);
    expect(b.map((x) => x.clave)).toEqual(['Golden Touch', 'Minera Demo']);
    expect(b[0].equivUsd).toBe(400);
  });
  it('los suspendidos no entran en los gráficos', () => {
    const d = donutCategoria([...gastos, g({ categoria: 'Honorarios', monto: 9999, estado: 'suspendido' })], 40);
    expect(d.some((x) => x.clave === 'Honorarios')).toBe(false);
  });
});
