import { describe, expect, it } from 'vitest';
import {
  agruparTotales, periodosEntre, proximoVencimiento, tokenPeriodo, totalGeneral, vencimientoDe,
  type MovimientoCalc,
} from './administracionCalculo';

const f = (y: number, m: number, d: number) => new Date(y, m - 1, d);
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('tokenPeriodo · noviembre de 2026 (mes 11)', () => {
  it('un token por periodicidad, como el CHECK de BD', () => {
    const nov = f(2026, 11, 20);
    expect(tokenPeriodo(nov, 'mensual')).toBe('2026-11');
    expect(tokenPeriodo(nov, 'bimensual')).toBe('2026-B6');
    expect(tokenPeriodo(nov, 'trimestral')).toBe('2026-T4');
    expect(tokenPeriodo(nov, 'semestral')).toBe('2026-S2');
    expect(tokenPeriodo(nov, 'anual')).toBe('2026');
    expect(tokenPeriodo('2026-01-01', 'bimensual')).toBe('2026-B1');
    expect(tokenPeriodo('2026-07-15', 'semestral')).toBe('2026-S2');
  });
});

describe('vencimientoDe', () => {
  it('mensual: día del mes, recortado al último día', () => {
    expect(iso(vencimientoDe('2026-11-01', 'mensual', 15))).toBe('2026-11-15');
    expect(iso(vencimientoDe('2026-02-10', 'mensual', 31))).toBe('2026-02-28'); // 2026 no bisiesto
    expect(iso(vencimientoDe('2026-11-20', 'mensual', null))).toBe('2026-11-01'); // sin día → día 1
  });
  it('plurimensual: cae en el PRIMER mes del período', () => {
    // T4 = oct–dic → primer mes octubre
    expect(iso(vencimientoDe('2026-11-20', 'trimestral', 5))).toBe('2026-10-05');
    // S2 = jul–dic → primer mes julio
    expect(iso(vencimientoDe('2026-11-20', 'semestral', 10))).toBe('2026-07-10');
    // anual → enero
    expect(iso(vencimientoDe('2026-11-20', 'anual', 3))).toBe('2026-01-03');
  });
});

describe('proximoVencimiento', () => {
  const g = { periodicidad: 'mensual' as const, diaVencimiento: 10, vigenteDesde: '2020-01-01' };
  it('si el vencimiento del período de hoy ya pasó, toma el siguiente', () => {
    expect(iso(proximoVencimiento(g, f(2026, 11, 15)))).toBe('2026-12-10');
  });
  it('si aún no pasó, es el de este período', () => {
    expect(iso(proximoVencimiento(g, f(2026, 11, 5)))).toBe('2026-11-10');
    expect(iso(proximoVencimiento(g, f(2026, 11, 10)))).toBe('2026-11-10'); // hoy = vencimiento
  });
  it('nunca antes de vigenteDesde (gasto que empieza en el futuro)', () => {
    const futuro = { periodicidad: 'mensual' as const, diaVencimiento: 1, vigenteDesde: '2027-03-01' };
    expect(iso(proximoVencimiento(futuro, f(2026, 11, 15)))).toBe('2027-03-01');
  });
  it('trimestral: salta de trimestre en trimestre', () => {
    const t = { periodicidad: 'trimestral' as const, diaVencimiento: 5, vigenteDesde: '2026-01-01' };
    // T4 vence 2026-10-05; al 2026-11-15 ya pasó → T1 del 2027 (enero)
    expect(iso(proximoVencimiento(t, f(2026, 11, 15)))).toBe('2027-01-05');
  });
});

describe('periodosEntre (generar pendientes)', () => {
  it('mensual: un período por mes, inclusive', () => {
    const g = { periodicidad: 'mensual' as const, diaVencimiento: 1, vigenteDesde: '2026-09-01' };
    const ps = periodosEntre(g, '2026-11-15');
    expect(ps.map((p) => p.token)).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(iso(ps[2].vence)).toBe('2026-11-01');
  });
  it('trimestral: los 4 trimestres del año', () => {
    const g = { periodicidad: 'trimestral' as const, diaVencimiento: 10, vigenteDesde: '2026-01-01' };
    expect(periodosEntre(g, '2026-12-31').map((p) => p.token)).toEqual(['2026-T1', '2026-T2', '2026-T3', '2026-T4']);
  });
  it('no genera nada si vigenteDesde es posterior a hasta', () => {
    const g = { periodicidad: 'mensual' as const, diaVencimiento: 1, vigenteDesde: '2027-01-01' };
    expect(periodosEntre(g, '2026-11-15')).toEqual([]);
  });
});

describe('totales (reporte)', () => {
  const movs: MovimientoCalc[] = [
    { empresaClave: 'GT', categoria: 'Alquiler', moneda: 'USD', monto: 100 },
    { empresaClave: 'GT', categoria: 'Agua', moneda: 'Bs', monto: 400 },
    { empresaClave: 'MTO', categoria: 'Alquiler', moneda: 'USD', monto: 50 },
  ];
  it('por empresa, con conversión a tasa = 40 Bs/$', () => {
    const t = agruparTotales(movs, 'empresa', { tasa: 40 });
    const gt = t.find((x) => x.clave === 'GT')!;
    expect(gt).toMatchObject({ usd: 100, bs: 400, n: 2 });
    expect(gt.equivUsd).toBe(110); // 100 + 400/40
    expect(gt.equivBs).toBe(4400); // 400 + 100*40
    expect(t[0].clave).toBe('GT'); // GT pesa más en USD equivalente
  });
  it('por moneda y total general', () => {
    const porMoneda = agruparTotales(movs, 'moneda', { tasa: 40 });
    expect(porMoneda.map((x) => x.clave).sort()).toEqual(['Bs', 'USD']);
    const g = totalGeneral(movs, 40);
    expect(g).toMatchObject({ usd: 150, bs: 400 });
    expect(g.equivUsd).toBe(160); // 150 + 400/40
  });
  it('sin tasa no inventa conversión', () => {
    const g = totalGeneral(movs);
    expect(g.equivUsd).toBe(150); // solo el USD nativo
    expect(g.equivBs).toBe(400);
  });
  it('es determinista', () => {
    expect(agruparTotales(movs, 'categoria', { tasa: 40 })).toEqual(agruparTotales(movs, 'categoria', { tasa: 40 }));
  });
});
