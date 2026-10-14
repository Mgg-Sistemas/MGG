import { describe, expect, it } from 'vitest';
import { cortesValidos, leerCortes, periodicidadEn, tramoDe, tramosDelMes } from './periodos';

describe('los días de corte de una periodicidad personalizada (como retencion_cortes_validos)', () => {
  it('acepta de 2 a 10 cortes que empiezan en 1, crecientes y hasta el 28', () => {
    expect(cortesValidos([1, 11, 21])).toBe(true);
    expect(cortesValidos([1, 28])).toBe(true);
    expect(cortesValidos([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(true);
  });

  it('rechaza menos de 2 o más de 10 cortes', () => {
    expect(cortesValidos([])).toBe(false);
    expect(cortesValidos([1])).toBe(false);
    expect(cortesValidos([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])).toBe(false);
  });

  it('rechaza los que no empiezan en 1, no crecen o pasan del 28', () => {
    expect(cortesValidos([5, 15])).toBe(false);
    expect(cortesValidos([1, 15, 15])).toBe(false);
    expect(cortesValidos([1, 20, 10])).toBe(false);
    expect(cortesValidos([1, 29])).toBe(false);
    expect(cortesValidos([1, 10.5])).toBe(false);
  });

  it('lee los cortes escritos, sin repetir y en orden, sin añadir el 1', () => {
    expect(leerCortes('1, 11, 21')).toEqual([1, 11, 21]);
    expect(leerCortes('21 11 1 11')).toEqual([1, 11, 21]);
    expect(leerCortes('10, 20')).toEqual([10, 20]);
    expect(leerCortes('')).toEqual([]);
  });
});

describe('los tramos de un mes (como retencion_tramos_del_mes)', () => {
  it('mensual y por pago: un tramo, el 0, del primero al último día', () => {
    expect(tramosDelMes('mensual', '202602')).toEqual([{ tramo: 0, desde: '2026-02-01', hasta: '2026-02-28' }]);
    expect(tramosDelMes('por_pago', '202610')).toEqual([{ tramo: 0, desde: '2026-10-01', hasta: '2026-10-31' }]);
  });

  it('quincenal: del 1 al 15 y del 16 al fin de mes', () => {
    expect(tramosDelMes('quincenal', '202602')).toEqual([
      { tramo: 1, desde: '2026-02-01', hasta: '2026-02-15' },
      { tramo: 2, desde: '2026-02-16', hasta: '2026-02-28' },
    ]);
  });

  it('semanal: de lunes a domingo, cortada al principio y al fin del mes (octubre de 2026 empieza en jueves)', () => {
    expect(tramosDelMes('semanal', '202610')).toEqual([
      { tramo: 1, desde: '2026-10-01', hasta: '2026-10-04' },
      { tramo: 2, desde: '2026-10-05', hasta: '2026-10-11' },
      { tramo: 3, desde: '2026-10-12', hasta: '2026-10-18' },
      { tramo: 4, desde: '2026-10-19', hasta: '2026-10-25' },
      { tramo: 5, desde: '2026-10-26', hasta: '2026-10-31' },
    ]);
  });

  it('semanal: un mes que empieza en domingo tiene una primera semana de un día', () => {
    const ts = tramosDelMes('semanal', '202602');
    expect(ts).toHaveLength(5);
    expect(ts[0]).toEqual({ tramo: 1, desde: '2026-02-01', hasta: '2026-02-01' });
    expect(ts[4]).toEqual({ tramo: 5, desde: '2026-02-23', hasta: '2026-02-28' });
  });

  it('personalizada: del corte al día anterior al siguiente; el último llega al fin de mes', () => {
    expect(tramosDelMes('personalizada', '202602', [1, 11, 21])).toEqual([
      { tramo: 1, desde: '2026-02-01', hasta: '2026-02-10' },
      { tramo: 2, desde: '2026-02-11', hasta: '2026-02-20' },
      { tramo: 3, desde: '2026-02-21', hasta: '2026-02-28' },
    ]);
  });

  it('personalizada sin cortes válidos: el mismo error que la base', () => {
    expect(() => tramosDelMes('personalizada', '202610', [5, 15])).toThrow(/^RET_TRAMOS_SIN_CORTES: /);
    expect(() => tramosDelMes('personalizada', '202610')).toThrow(/^RET_TRAMOS_SIN_CORTES: /);
  });

  it('un período que no es AAAAMM: el mismo error que la base', () => {
    expect(() => tramosDelMes('mensual', '2026-10')).toThrow(/^RET_TRAMO_PERIODO: /);
    expect(() => tramosDelMes('mensual', '202613')).toThrow(/^RET_TRAMO_PERIODO: /);
  });

  it('ningún tramo cruza de un mes a otro, en ninguna periodicidad de todo el año', () => {
    for (let m = 1; m <= 12; m++) {
      const periodo = `2026${String(m).padStart(2, '0')}`;
      for (const per of ['mensual', 'quincenal', 'semanal'] as const) {
        const ts = tramosDelMes(per, periodo);
        expect(ts.every((t) => t.desde.slice(0, 7) === t.hasta.slice(0, 7))).toBe(true);
        expect(ts[0].desde.slice(8)).toBe('01');
      }
    }
  });
});

describe('el tramo de una fecha (como retencion_tramo_de)', () => {
  it('da el tramo que contiene la fecha', () => {
    expect(tramoDe('semanal', '2026-10-12')).toBe(3);
    expect(tramoDe('quincenal', '2026-10-15')).toBe(1);
    expect(tramoDe('quincenal', '2026-10-16')).toBe(2);
    expect(tramoDe('mensual', '2026-10-31')).toBe(0);
    expect(tramoDe('personalizada', '2026-10-21', [1, 11, 21])).toBe(3);
  });
});

describe('la periodicidad vigente en una fecha', () => {
  const historial = [
    { valor: 'quincenal' as const, cortes: null, desde: null },
    { valor: 'semanal' as const, cortes: null, desde: '2026-11-01' },
    { valor: 'personalizada' as const, cortes: [1, 11, 21], desde: '2027-01-01' },
  ];

  it('toma la última que ya rige en esa fecha', () => {
    expect(periodicidadEn(historial, '2026-10-31').valor).toBe('quincenal');
    expect(periodicidadEn(historial, '2026-11-01').valor).toBe('semanal');
    expect(periodicidadEn(historial, '2027-03-15').valor).toBe('personalizada');
  });

  it('no depende del orden en que llegue el historial', () => {
    expect(periodicidadEn([...historial].reverse(), '2026-12-01').valor).toBe('semanal');
  });

  it('si ninguna rige todavía, toma la primera', () => {
    const futura = [{ valor: 'mensual' as const, cortes: null, desde: '2027-01-01' }];
    expect(periodicidadEn(futura, '2026-10-01').valor).toBe('mensual');
  });
});
