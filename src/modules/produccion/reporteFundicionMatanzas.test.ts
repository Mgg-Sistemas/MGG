import { describe, it, expect } from 'vitest';
import {
  mezclaKg, snTeoricoKg, rendimientoPct, mermaKg, snRecuperableKg, pesoPromLingote,
  filaColada, agruparPorCiclo, totalesPeriodo, periodoDe, enRango, hallazgos,
  type ColadaReporte,
} from './reporteFundicionMatanzas';

/**
 * Las seis coladas del período 08–10 de agosto de 2026 en Matanzas, con los
 * ensayos XRF de sus escorias. Los resultados esperados son los del reporte
 * formal que firmó la Gerencia de Producción: si las cuentas del sistema no
 * dan lo mismo, el reporte no sirve.
 */
const base = (p: Partial<ColadaReporte>): ColadaReporte => ({
  produccion_id: 'x', colada_num: 0, fecha: '2026-08-08', turno: 'Diurno',
  casiterita_kg: 0, coque_kg: 0, caliza_kg: 0, estano_kg: 0, n_lingotes: null,
  escoria_kg: 0, temp_colada: null, duracion_horas: null, ley_sn_real: null,
  responsable: 'OSCAR AZUAJE', horno: 'Horno Fundición Nro. 01', observaciones: '',
  ...p,
});

const PERIODO: ColadaReporte[] = [
  base({ colada_num: 1, fecha: '2026-08-08', turno: 'Diurno', casiterita_kg: 1682, coque_kg: 424.5, caliza_kg: 65.5, estano_kg: 847.5, n_lingotes: 27, escoria_kg: 0, temp_colada: 983, duracion_horas: 12.33, ley_sn_real: 53.09 }),
  base({ colada_num: 2, fecha: '2026-08-08', turno: 'Nocturno', casiterita_kg: 1577.5, coque_kg: 392.5, caliza_kg: 60.5, estano_kg: 882, n_lingotes: 25, escoria_kg: 294.5, temp_colada: 1290, duracion_horas: 6.5, sn_escoria_pct: 12.43 }),
  base({ colada_num: 3, fecha: '2026-08-09', turno: 'Diurno', casiterita_kg: 1632.5, coque_kg: 373, caliza_kg: 58.5, estano_kg: 927.5, n_lingotes: 30, escoria_kg: 0, temp_colada: 1250, duracion_horas: 8.37 }),
  base({ colada_num: 4, fecha: '2026-08-09', turno: 'Nocturno', casiterita_kg: 1708.5, coque_kg: 371, caliza_kg: 66, estano_kg: 1058.5, n_lingotes: 33, escoria_kg: 344, temp_colada: 1367, duracion_horas: 7.32, sn_escoria_pct: 23.91 }),
  base({ colada_num: 5, fecha: '2026-08-10', turno: 'Nocturno', casiterita_kg: 1814, coque_kg: 380.5, caliza_kg: 59, estano_kg: 1167, n_lingotes: 38, escoria_kg: 0, temp_colada: 1402, duracion_horas: 7.13 }),
  base({ colada_num: 6, fecha: '2026-08-10', turno: 'Diurno', casiterita_kg: 1878, coque_kg: 409, caliza_kg: 71.5, estano_kg: 1162, n_lingotes: 39, escoria_kg: 135, temp_colada: null, duracion_horas: 7.17, sn_escoria_pct: 6.61 }),
];

const TENOR = 65;
const filas = PERIODO.map((c) => filaColada(c, TENOR));

describe('las cuentas de una colada', () => {
  it('la mezcla es casiterita más fundentes', () => {
    expect(mezclaKg(PERIODO[0])).toBe(2172);
    expect(mezclaKg(PERIODO[5])).toBe(2358.5);
  });

  it('el Sn teórico sale del tenor aplicado', () => {
    expect(snTeoricoKg(1682, 65)).toBe(1093.3);
    expect(snTeoricoKg(1577.5, 65)).toBe(1025.38);
  });

  it('un tenor más alto baja el rendimiento: por eso se declara', () => {
    expect(rendimientoPct(847.5, snTeoricoKg(1682, 65))).toBe(77.52);
    expect(rendimientoPct(847.5, snTeoricoKg(1682, 53.09))).toBe(94.91);
  });

  it('la merma es la masa que no salió ni como estaño ni como escoria', () => {
    expect(mermaKg(PERIODO[0])).toBe(1324.5);
    expect(mermaKg(PERIODO[1])).toBe(854);
    expect(mermaKg(PERIODO[3])).toBe(743);
  });

  it('el peso por lingote, y sin lingotes contados no se inventa', () => {
    expect(pesoPromLingote(847.5, 27)).toBe(31.39);
    expect(pesoPromLingote(882, 25)).toBe(35.28);
    expect(pesoPromLingote(1000, null)).toBeNull();
    expect(pesoPromLingote(1000, 0)).toBeNull();
  });

  it('sin ensayo XRF no se supone estaño en la escoria', () => {
    expect(snRecuperableKg(294.5, 12.43)).toBe(36.61);
    // El reporte firmado dice 82,23: redondeó el % XRF a 23,91 y de ahí sacó los kg.
    // Con ese 23,91 la cuenta exacta da 82,25, y es la que vale.
    expect(snRecuperableKg(344, 23.91)).toBe(82.25);
    expect(snRecuperableKg(294.5, null)).toBe(0);
    expect(snRecuperableKg(0, 12.43)).toBe(0);
  });

  it('sin nada contra qué medir, el rendimiento es nulo y no cero', () => {
    expect(rendimientoPct(500, 0)).toBeNull();
  });
});

describe('los ciclos de recuperación de escoria', () => {
  const grupos = agruparPorCiclo(filas, 2);

  it('agrupa de a dos coladas, que es cada cuánto se saca la escoria', () => {
    expect(grupos).toHaveLength(3);
    expect(grupos[0].coladas.map((c) => c.colada_num)).toEqual([1, 2]);
    expect(grupos[2].coladas.map((c) => c.colada_num)).toEqual([5, 6]);
  });

  it('el primer ciclo da los números del reporte firmado', () => {
    const g = grupos[0];
    expect(g.casiterita_kg).toBe(3259.5);
    expect(g.sn_teorico_kg).toBe(2118.68);
    expect(g.estano_kg).toBe(1729.5);
    expect(g.escoria_kg).toBe(294.5);
    expect(g.sn_recuperable_kg).toBe(36.61);
    expect(g.rendimiento_pct).toBe(81.63);
    expect(g.rendimiento_potencial_pct).toBe(83.36);
  });

  it('el segundo ciclo es el de mayor ganancia por reprocesar', () => {
    const g = grupos[1];
    expect(g.rendimiento_pct).toBe(91.45);
    expect(g.rendimiento_potencial_pct).toBe(95.24);
  });

  it('el tercero es el mejor del período', () => {
    expect(grupos[2].rendimiento_pct).toBe(97.05);
  });

  it('un período impar deja el último ciclo incompleto, no lo descarta', () => {
    const g = agruparPorCiclo(filas.slice(0, 5), 2);
    expect(g).toHaveLength(3);
    expect(g[2].coladas.map((c) => c.colada_num)).toEqual([5]);
  });
});

describe('los totales del período', () => {
  const tot = totalesPeriodo(filas);

  it('el rendimiento global del período', () => {
    expect(tot.estano_kg).toBe(6044.5);
    expect(tot.rendimiento_pct).toBe(90.35);
  });

  it('reprocesar las escorias lo subiría', () => {
    expect(tot.sn_recuperable_kg).toBe(127.78);
    expect(tot.rendimiento_potencial_pct).toBe(92.26);
  });

  it('la merma del período se mide en estaño, no en masa de escoria', () => {
    // 6690,14 − 6044,50 − 127,78. Restar los 773,5 kg de escoria entera daría
    // un balance negativo: esa masa es hierro, tántalo y niobio, no estaño.
    expect(tot.merma_kg).toBe(517.86);
    expect(tot.merma_kg).toBeGreaterThan(0);
  });

  it('los kilos y los lingotes del período', () => {
    expect(tot.casiterita_kg).toBe(10292.5);
    expect(tot.escoria_kg).toBe(773.5);
    expect(tot.n_lingotes).toBe(192);
    expect(tot.coladas).toBe(6);
  });

  it('la duración promedio ignora las coladas sin dato', () => {
    expect(tot.duracion_prom_horas).toBe(8.14);
  });
});

describe('elegir qué coladas entran', () => {
  it('el período se deduce de las coladas elegidas', () => {
    expect(periodoDe(filas)).toEqual({ desde: '2026-08-08', hasta: '2026-08-10' });
    expect(periodoDe([])).toBeNull();
  });

  it('el rango de fechas recorta, con los bordes adentro', () => {
    expect(enRango(filas, '2026-08-09', '2026-08-09').map((f) => f.colada_num)).toEqual([3, 4]);
    expect(enRango(filas, '2026-08-10', '').map((f) => f.colada_num)).toEqual([5, 6]);
    expect(enRango(filas, '', '').map((f) => f.colada_num)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('los hallazgos que el reporte puede afirmar solo', () => {
  const grupos = agruparPorCiclo(filas, 2);
  const tot = totalesPeriodo(filas);
  const hs = hallazgos(filas, grupos, tot, TENOR);

  it('avisa que la escoria no sale cada dos coladas', () => {
    expect(hs.some((h) => h.includes('#2, #4, #6') && h.includes('#1, #3, #5'))).toBe(true);
  });

  it('nombra la mejor y la peor colada', () => {
    expect(hs.some((h) => h.includes('#5') && h.includes('98.97'))).toBe(true);
  });

  it('avisa cuando el tenor fijo no es la ley de laboratorio', () => {
    expect(hs.some((h) => h.includes('tenor fijo de 65 %') && h.includes('#1: 53.09 %'))).toBe(true);
  });

  it('señala la colada sin temperatura', () => {
    expect(hs.some((h) => h.includes('Sin temperatura') && h.includes('#6'))).toBe(true);
  });

  it('sin coladas no inventa hallazgos', () => {
    expect(hallazgos([], [], totalesPeriodo([]), 65)).toEqual([]);
  });
});
