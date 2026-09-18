import { describe, expect, it } from 'vitest';
import {
  filaRefinacion, totalesRefinacion, reactivosDelPeriodo, hallazgosRefinacion,
  cadenas, totalesCadena, brutoSinRefinar, hallazgosCadena, type RefinacionReporte,
} from './reporteRefinacionMatanzas';
import type { ColadaReporte } from './reporteFundicionMatanzas';

// El caso real: colada #1 (1.683,5 kg de casiterita → 837,5 kg de estaño bruto)
// refinada entera en la refinación #1 (725 kg refinados, 287 kg de dross).
const colada = (p: Partial<ColadaReporte> = {}): ColadaReporte => ({
  produccion_id: 'c1', colada_num: 1, fecha: '2026-08-08', turno: '', casiterita_kg: 1683.5, coque_kg: 0, caliza_kg: 0,
  estano_kg: 837.5, n_lingotes: null, escoria_kg: 0, temp_colada: null, duracion_horas: null, ley_sn_real: null,
  responsable: '', horno: '', observaciones: '', ...p,
});
const refin = (p: Partial<RefinacionReporte> = {}): RefinacionReporte => ({
  produccion_id: 'r1', refinacion_num: 1, fecha: '2026-05-23', turno: 'Mañana', responsable: 'JEHOVA OCHOA', horno: 'CRISOL 1',
  origenes: [{ produccion_id: 'c1', origen: 'colada', etiqueta: 'Colada #1', colada_num: 1, estano_kg: 837.5 }],
  crudo_kg: 837.5, pureza_inicial: null,
  reactivos: [{ nombre: 'CARBON VEGETAL', kg: 19.5 }, { nombre: 'SODA CAUSTICA', kg: 0.63 }],
  refinado_kg: 725, n_lingotes: 27, dross_kg: 287, pureza_final: null, temp_colada: null, duracion_horas: 8.67,
  precinto: '', costo_total: 120.67, observaciones: '', ...p,
});

describe('reporte de refinación', () => {
  it('rendimiento contra el crudo, peso por lingote, costo por kg y merma', () => {
    const f = filaRefinacion(refin());
    expect(f.rendimiento_pct).toBe(86.57);
    expect(f.peso_prom_lingote).toBe(26.85);
    expect(f.costo_kg).toBe(0.17);
    expect(f.reactivos_kg).toBe(20.13);
    expect(f.merma_kg).toBe(-174.5);
  });

  it('totales y reactivos por tonelada de crudo', () => {
    const fs = [filaRefinacion(refin()), filaRefinacion(refin({ produccion_id: 'r2', refinacion_num: 2, crudo_kg: 162.5, refinado_kg: 150, dross_kg: 10, n_lingotes: 6 }))];
    const t = totalesRefinacion(fs);
    expect(t.crudo_kg).toBe(1000);
    expect(t.refinado_kg).toBe(875);
    expect(t.rendimiento_pct).toBe(87.5);
    expect(t.n_lingotes).toBe(33);
    expect(reactivosDelPeriodo(fs)[0]).toEqual({ nombre: 'CARBON VEGETAL', kg: 39, kg_por_ton: 39 });
  });

  it('avisa la merma negativa y lo que falta registrar', () => {
    const f = [filaRefinacion(refin())];
    const h = hallazgosRefinacion(f, totalesRefinacion(f)).join(' ');
    expect(h).toMatch(/#1 \(-174.5 kg\)/);
    expect(h).toMatch(/Sin pureza final/);
  });
});

describe('colada + refinación', () => {
  it('encadena casiterita → bruto → refinado', () => {
    const [c] = cadenas([filaRefinacion(refin())], [colada()], 65);
    expect(c.sn_teorico_kg).toBe(1094.28);            // 1683,5 × 65 %
    expect(c.rendimiento_fundicion_pct).toBe(76.53);  // 837,5 ÷ 1094,28
    expect(c.rendimiento_refinacion_pct).toBe(86.57);
    expect(c.rendimiento_global_pct).toBe(66.25);     // 725 ÷ 1094,28
  });

  it('una colada tomada a medias se atribuye en proporción', () => {
    const r = refin({ origenes: [{ produccion_id: 'c1', origen: 'colada', etiqueta: 'Colada #1', colada_num: 1, estano_kg: 418.75 }], crudo_kg: 418.75, refinado_kg: 362.5 });
    const [c] = cadenas([filaRefinacion(r)], [colada()], 65);
    expect(c.tramos[0].fraccion).toBe(0.5);
    expect(c.casiterita_kg).toBe(841.75);
    expect(brutoSinRefinar([colada()], [r])).toEqual([{ colada_num: 1, fecha: '2026-08-08', estano_kg: 837.5, refinado_desde_kg: 418.75, pendiente_kg: 418.75 }]);
  });

  it('el crudo manual queda fuera del global y se avisa', () => {
    const r = refin({ origenes: [
      { produccion_id: 'c1', origen: 'colada', etiqueta: 'Colada #1', colada_num: 1, estano_kg: 837.5 },
      { produccion_id: 'm1', origen: 'manual', etiqueta: 'Lingotes viejos', colada_num: null, estano_kg: 162.5 },
    ], crudo_kg: 1000, refinado_kg: 900 });
    const cs = cadenas([filaRefinacion(r)], [colada()], 65);
    expect(cs[0].crudo_sin_trazar_kg).toBe(162.5);
    const h = hallazgosCadena(cs, totalesCadena(cs), 65).join(' ');
    expect(h).toMatch(/no viene de una colada/);
    expect(h).toMatch(/Fechas que no cierran/);   // la refinación #1 está fechada antes que su colada
  });
});
