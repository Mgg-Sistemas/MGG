import { describe, it, expect } from 'vitest';
import {
  DIAS_TRABAJADOS, DIAS_DESCANSO, DIAS_QUINCENA,
  diasDelMes, quincenaDeFecha, diasDeQuincena, diasDeFecha, etiquetaQuincena,
} from './diasQuincena';

describe('la quincena tipo', () => {
  it('son 11 trabajados y 4 de descanso', () => {
    expect(DIAS_TRABAJADOS).toBe(11);
    expect(DIAS_DESCANSO).toBe(4);
    expect(DIAS_QUINCENA).toBe(15);
  });
});

describe('cuántos días trae el mes', () => {
  it('los meses de 31', () => {
    for (const m of [1, 3, 5, 7, 8, 10, 12]) expect(diasDelMes(2026, m)).toBe(31);
  });
  it('los meses de 30', () => {
    for (const m of [4, 6, 9, 11]) expect(diasDelMes(2026, m)).toBe(30);
  });
  it('febrero normal y bisiesto', () => {
    expect(diasDelMes(2026, 2)).toBe(28);
    expect(diasDelMes(2028, 2)).toBe(29);
  });
});

describe('a qué quincena cae una fecha', () => {
  it('hasta el 15, la primera', () => {
    expect(quincenaDeFecha('2026-09-01')).toBe(1);
    expect(quincenaDeFecha('2026-09-15')).toBe(1);
  });
  it('del 16 en adelante, la segunda', () => {
    expect(quincenaDeFecha('2026-09-16')).toBe(2);
    expect(quincenaDeFecha('2026-09-23')).toBe(2);
    expect(quincenaDeFecha('2026-08-31')).toBe(2);
  });
});

describe('los días que se pagan', () => {
  it('la primera quincena son siempre 11 + 4, en cualquier mes', () => {
    for (const m of [1, 2, 4, 9, 12]) {
      expect(diasDeQuincena(2026, m, 1)).toEqual({ trabajados: 11, descanso: 4, total: 15 });
    }
  });

  it('en un mes de 30, la segunda también es 11 + 4', () => {
    expect(diasDeQuincena(2026, 9, 2)).toEqual({ trabajados: 11, descanso: 4, total: 15 });
  });

  it('en un mes de 31, el día de más va al DESCANSO: 11 + 5', () => {
    expect(diasDeQuincena(2026, 8, 2)).toEqual({ trabajados: 11, descanso: 5, total: 16 });
    expect(diasDeQuincena(2026, 12, 2)).toEqual({ trabajados: 11, descanso: 5, total: 16 });
  });

  it('en febrero la segunda quincena es más corta, y lo que se acorta es el descanso', () => {
    expect(diasDeQuincena(2026, 2, 2)).toEqual({ trabajados: 11, descanso: 2, total: 13 });
    expect(diasDeQuincena(2028, 2, 2)).toEqual({ trabajados: 11, descanso: 3, total: 14 });
  });

  it('los trabajados NUNCA se mueven: son 11 en todos los casos', () => {
    const casos: Array<[number, number, 1 | 2]> = [
      [2026, 1, 1], [2026, 1, 2], [2026, 2, 1], [2026, 2, 2],
      [2026, 4, 2], [2026, 9, 2], [2028, 2, 2], [2026, 12, 2],
    ];
    for (const [a, m, q] of casos) expect(diasDeQuincena(a, m, q).trabajados).toBe(11);
  });

  it('trabajados + descanso siempre da el total', () => {
    for (let m = 1; m <= 12; m++) {
      for (const q of [1, 2] as const) {
        const d = diasDeQuincena(2026, m, q);
        expect(d.trabajados + d.descanso).toBe(d.total);
      }
    }
  });

  it('las dos quincenas cubren el mes entero', () => {
    for (let m = 1; m <= 12; m++) {
      const a = diasDeQuincena(2026, m, 1).total;
      const b = diasDeQuincena(2026, m, 2).total;
      expect(a + b).toBe(diasDelMes(2026, m));
    }
  });
});

describe('desde una fecha suelta', () => {
  it('saca el mes y la quincena de la fecha', () => {
    expect(diasDeFecha('2026-09-23')).toEqual({ trabajados: 11, descanso: 4, total: 15 });
    expect(diasDeFecha('2026-08-20')).toEqual({ trabajados: 11, descanso: 5, total: 16 });
    expect(diasDeFecha('2026-02-28')).toEqual({ trabajados: 11, descanso: 2, total: 13 });
    expect(diasDeFecha('2026-03-05')).toEqual({ trabajados: 11, descanso: 4, total: 15 });
  });

  it('una fecha vacía no rompe: cae en la primera quincena', () => {
    expect(diasDeFecha('').trabajados).toBe(11);
    expect(quincenaDeFecha('')).toBe(1);
  });
});

describe('el nombre de la quincena', () => {
  it('dice cuál es', () => {
    expect(etiquetaQuincena('2026-09-10')).toBe('Primera quincena');
    expect(etiquetaQuincena('2026-09-23')).toBe('Segunda quincena');
  });
});
