import { describe, expect, it } from 'vitest';
import {
  calcularLibro, calcularEntrada, calcularLotes, cierresPorPasar, coladasPorPasar, errorNuevoLote, errorNuevoMov, leerNumero, movDePropuesta,
  procedenciaDeGrupo, resumenPorMes, saldoAl, saldoFinal, simularLote,
  type CierreRecepcionPmp, type ColadaCas, type LoteCas, type MovPmp, type ProcedenciaPmp, type TipoMovPmp,
} from './casiteritaPmp';

/* Cifras inventadas (las reales del Excel se validan aparte, fuera del repositorio). */
type S = [string, TipoMovPmp, string, Partial<MovPmp>];
const SEMILLA: S[] = [
  ['2026-01-01', 'apertura', 'Saldo inicial', { kg_global: 10000, kg_mgg: 6000, costo: 60000 }],      // PMP 10
  ['2026-01-05', 'entrada', 'Aliado 50 %', { kg_global: 4000, kg_mgg: 2000, costo: 30000 }],           // MGG 8000 · costo 90000
  ['2026-01-10', 'exportacion', 'Lote A', { kg: 7000 }],                                                // 50 % del galpón
  ['2026-01-10', 'muestra', 'Muestras lote A', { kg: 10 }],
  ['2026-01-20', 'merma', 'Merma que no toca MGG', { kg: 5, afecta_mgg: false }],
  ['2026-02-02', 'recuperacion', 'Sacudida de bolsas', { kg: 90 }],
  ['2026-02-03', 'ajuste', 'Sobrante del conteo', { kg: -15 }],
];
const mov = ([fecha, tipo, descripcion, p]: S, i: number): MovPmp => ({
  id: `m${i}`, fecha, tipo, descripcion, kg: null, kg_global: null, kg_mgg: null, costo: null, afecta_mgg: true,
  procedencia: null, pct_mgg: null, tasa: null, recepcion_numero: null, cierre_id: null, lote_id: null, colada_id: null,
  origen: 'sistema', orden: i + 1, nota: null, actor_name: null, created_at: '', ...p,
});
const MOVS = SEMILLA.map(mov);
const filas = calcularLibro(MOVS);
const fila = (d: string) => filas.find((f) => f.descripcion === d)!;

describe('libro de promedios · reglas', () => {
  it('una entrada suma global, MGG y costo; el resto es resguardo', () => {
    const s = saldoAl(filas, '2026-01-05');
    expect(s).toMatchObject({ global: 14000, mgg: 8000, costo: 90000, resguardo: 6000 });
    expect(s.pmp).toBeCloseTo(11.25, 10);
  });
  it('un lote se lleva de MGG la misma proporción que del galpón, al PMP', () => {
    const l = fila('Lote A');
    expect(l.pct).toBeCloseTo(0.5, 10);
    expect(l.dM).toBeCloseTo(-4000, 8);
    expect(l.dC).toBeCloseTo(-45000, 6);
    expect(l.dResg).toBeCloseTo(-3000, 8);
    expect(l.pmp).toBeCloseTo(11.25, 10); // salir al PMP no cambia el PMP
  });
  it('muestra sale entera de MGG; la merma marcada no toca MGG', () => {
    expect(fila('Muestras lote A')).toMatchObject({ dG: -10, dM: -10 });
    expect(fila('Merma que no toca MGG')).toMatchObject({ dG: -5, dM: 0, dC: 0, dResg: -5 });
  });
  it('la recuperación entra a costo 0 y baja el PMP; un ajuste negativo entra al PMP', () => {
    const r = fila('Sacudida de bolsas');
    expect(r).toMatchObject({ dG: 90, dM: 90, dC: 0 });
    expect(r.pmp).toBeLessThan(r.pmpAntes);
    const a = fila('Sobrante del conteo');
    expect(a.dG).toBe(15);
    expect(a.pmp).toBeCloseTo(a.pmpAntes, 10);
  });
  it('resumen por mes: abre con el cierre del anterior', () => {
    const r = resumenPorMes(filas);
    expect(r.map((x) => x.mes)).toEqual(['2026-01', '2026-02']);
    expect(r[1].apertura).toEqual(r[0].cierre);
    expect(r[0].exportadoKg).toBe(7000);
    expect(r[1].entradasKg).toBe(105);
    expect(saldoFinal(filas).global).toBeCloseTo(14000 - 7000 - 10 - 5 + 90 + 15, 6);
  });
});

describe('libro de promedios · entradas y validaciones', () => {
  it('entrada: kg MGG = kg × %, costo = kg MGG × tasa', () => {
    expect(calcularEntrada(16400.5, 50, 14)).toEqual({ kgMgg: 8200.25, costo: 114803.5 });
    expect(calcularEntrada(1000, 100, 15.5)).toEqual({ kgMgg: 1000, costo: 15500 });
  });
  it('reconoce la procedencia por el grupo de recepción', () => {
    const procs: ProcedenciaPmp[] = [
      { clave: 'P-A', nombre: 'Aliado', pct_mgg: 50, patron: 'NAVIL|VENTUARI', nota: null, activo: true },
      { clave: 'P-B', nombre: 'Propia', pct_mgg: 100, patron: 'ESPERANZA', nota: null, activo: true },
    ];
    expect(procedenciaDeGrupo('EL BURRO NAVIL', procs)?.clave).toBe('P-A');
    expect(procedenciaDeGrupo('RECEPCIÓN LA ESPERANZA', procs)?.pct_mgg).toBe(100);
    expect(procedenciaDeGrupo('OTRA', procs)).toBeNull();
  });
  it('no deja sacar más de lo que hay ni cargar antes de la apertura', () => {
    expect(errorNuevoMov({ fecha: '2026-03-01', tipo: 'muestra', descripcion: 'x', kg: 99999 }, filas)).toMatch(/No hay tanto/);
    expect(errorNuevoMov({ fecha: '2026-03-01', tipo: 'fundicion', descripcion: 'x', kg: 5000 }, filas)).toMatch(/inventario MGG/);
    expect(errorNuevoMov({ fecha: '2025-12-31', tipo: 'muestra', descripcion: 'x', kg: 1 }, filas)).toMatch(/abre el/);
    expect(errorNuevoMov({ fecha: '2026-03-01', tipo: 'merma', descripcion: 'x', kg: 5 }, filas)).toBeNull();
    expect(errorNuevoMov({ fecha: '2026-03-01', tipo: 'ajuste', descripcion: 'sobrante', kg: -3 }, filas)).toBeNull();
    expect(errorNuevoMov({ fecha: '2026-03-01', tipo: 'entrada', descripcion: 'x', kg_global: 10, pct_mgg: 100 }, filas)).toMatch(/tasa/);
  });
  it('lee números a la venezolana', () => {
    expect(leerNumero('1.431,5')).toBe(1431.5);
    expect(leerNumero('28000')).toBe(28000);
    expect(leerNumero('15,75')).toBe(15.75);
    expect(leerNumero('')).toBeNull();
  });
});

describe('libro de promedios · fase 2 · cierres de recepción por pasar', () => {
  const procs: ProcedenciaPmp[] = [{ clave: 'P-A', nombre: 'Aliado', pct_mgg: 50, patron: 'NAVIL', nota: null, activo: true }];
  const cierre = (id: string, p: Partial<CierreRecepcionPmp>): CierreRecepcionPmp => ({
    id, numero: 80, grupo_nombre: 'EL BURRO NAVIL', fecha: '2026-03-05T15:00:00Z', neto_seco: 1000, tasa_final: 12, almacen_neto: 'SNO₂ CASITERITA ALMACEN', ...p,
  });
  it('propone los cierres con casiterita, desde la apertura y que no estén ya en el libro', () => {
    const movs = [...MOVS, mov(['2026-03-01', 'entrada', 'ya pasada', { kg_global: 500, kg_mgg: 500, costo: 1, cierre_id: 'ya' }], 50)];
    const r = cierresPorPasar([
      cierre('nuevo', {}),
      cierre('ya', {}),
      cierre('viejo', { fecha: '2025-12-20T12:00:00Z' }),
      cierre('otro-almacen', { almacen_neto: 'GENERAL' }),
      cierre('vacio', { neto_seco: 0 }),
    ], movs, procs);
    expect(r.map((x) => x.cierre.id)).toEqual(['nuevo']);
    expect(r[0]).toMatchObject({ fecha: '2026-03-05', kg: 1000, pct: 50, tasa: 12, kgMgg: 500, costo: 6000 });
    expect(r[0].procedencia?.clave).toBe('P-A');
    const m = movDePropuesta(r[0], r[0].procedencia, 50, 12);
    expect(m).toMatchObject({ tipo: 'entrada', kg_global: 1000, pct_mgg: 50, tasa: 12, procedencia: 'P-A' });
    expect(m.descripcion).toBe('Recepción #80 · P-A Aliado');
  });
});

describe('libro de promedios · fase 3 · lotes y fundición', () => {
  const lote = (id: string, p: Partial<LoteCas>): LoteCas => ({
    id, codigo: id, exportacion_id: 'e1', fecha: '2026-01-10', kg: 7000, muestras_kg: 10, merma_kg: 0, ley_sgs: 66.5, informe_sgs_path: null,
    precintos: null, motivo: null, estado: 'galpon', despachado_en: null, despachado_por_name: null, historico: false, kg_mgg_hist: null, costo_hist: null, actor_name: null, ...p,
  });
  it('el lote del libro toma su kg MGG y costo del movimiento; el histórico, del Excel', () => {
    const movs = MOVS.map((m) => (m.descripcion === 'Lote A' ? { ...m, lote_id: 'L1' } : m));
    const [a, h, s] = calcularLotes([
      lote('L1', {}),
      lote('H1', { historico: true, kg: 28000, kg_mgg_hist: 20000, costo_hist: 300000, ley_sgs: null }),
      lote('S1', {}),
    ], calcularLibro(movs));
    expect(a).toMatchObject({ kgMgg: 4000, costo: 45000, pmp: 11.25, resguardoKg: 3000, delExcel: false });
    expect(a.pct).toBeCloseTo(0.5, 10);
    expect(a.snKg).toBeCloseTo(4655, 6);
    expect(h).toMatchObject({ kgMgg: 20000, costo: 300000, pmp: 15, resguardoKg: 8000, delExcel: true });
    expect(s.kgMgg).toBeNull();
  });
  it('no deja armar un lote más grande que el galpón; pide motivo si no es de 28.000 kg', () => {
    const disp = saldoFinal(filas).global;
    expect(errorNuevoLote({ fecha: '2026-03-01', kg: 28000, muestras: 0, merma: 0 }, filas)).toMatch(/No hay tanto/);
    expect(errorNuevoLote({ fecha: '2026-03-01', kg: 5000, muestras: 0, merma: 0 }, filas)).toMatch(/motivo/);
    expect(errorNuevoLote({ fecha: '2026-03-01', kg: disp / 2, muestras: 10, merma: 10, motivo: 'medio galpón' }, filas)).toBeNull();
    // Si el lote se lleva casi todo, casi no queda MGG para las muestras y la merma (salen enteras de MGG).
    expect(errorNuevoLote({ fecha: '2026-03-01', kg: disp - 20, muestras: 10, merma: 10, motivo: 'lo que queda' }, filas)).toMatch(/inventario MGG/);
    expect(errorNuevoLote({ fecha: '2026-03-01', kg: disp - 20, muestras: 10, merma: 11, motivo: 'x' }, filas)).toMatch(/No hay tanto/);
  });
  it('la vista previa del lote sale con la proporción del galpón', () => {
    const s0 = saldoFinal(filas);
    const sim = simularLote({ fecha: '2026-03-01', kg: s0.global / 2, muestras: 0, merma: 0 }, filas)!;
    expect(sim.lote.pct).toBeCloseTo(0.5, 10);
    expect(sim.fin.mgg).toBeCloseTo(s0.mgg / 2, 6);
    expect(sim.fin.pmp).toBeCloseTo(s0.pmp, 8);
  });
  it('propone las coladas con casiterita, desde la apertura y no cubiertas', () => {
    const c = (id: string, n: number, fecha: string | null, kg: number): ColadaCas => ({ id, colada_num: n, fecha, kg, bags: 1 });
    const r = coladasPorPasar([c('a', 3, '2026-02-01', 500), c('b', 1, '2026-02-01', 400), c('c', 2, '2025-12-01', 300), c('d', 4, '2026-02-01', 0), c('e', 5, '2026-02-02', 100)], new Set(['e']), filas);
    expect(r.map((x) => x.colada_num)).toEqual([1, 3]);
  });
});
