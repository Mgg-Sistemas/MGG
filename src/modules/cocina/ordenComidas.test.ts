import { describe, it, expect } from 'vitest';
import { compararComidas, ordenTipoComida, diaDeComida } from './cocina.repository';
import type { TipoComida } from '@/shared/lib/types';

/** Una comida como la guarda la base: la fecha va al MEDIODÍA, sin hora real. */
const c = (dia: string, tipo: TipoComida) => ({ at: `${dia}T16:00:00.000Z`, tipo_comida: tipo });
const leer = (xs: ReturnType<typeof c>[]) =>
  [...xs].sort(compararComidas).map((x) => `${diaDeComida(x.at).slice(8)} ${x.tipo_comida}`);

describe('orden de las comidas', () => {
  it('el día más nuevo va arriba, aunque se hayan cargado desordenados', () => {
    // Se cargó primero el 29, después el 01 y al final el 30.
    const cargadas = [c('2026-08-29', 'desayuno'), c('2026-09-01', 'desayuno'), c('2026-08-30', 'desayuno')];
    expect(leer(cargadas)).toEqual(['01 desayuno', '30 desayuno', '29 desayuno']);
  });

  it('dentro de un día se sirven en orden, no en el que se cargaron', () => {
    // Este es el caso que estaba roto: las tres comparten `at` hasta el minuto,
    // así que sin desempate quedaban en el orden en que se registraron.
    const cargadas = [c('2026-09-03', 'cena'), c('2026-09-03', 'desayuno'), c('2026-09-03', 'almuerzo')];
    expect(leer(cargadas)).toEqual(['03 desayuno', '03 almuerzo', '03 cena']);
  });

  it('los dos criterios juntos', () => {
    const cargadas = [
      c('2026-08-30', 'cena'), c('2026-09-01', 'almuerzo'), c('2026-08-30', 'desayuno'),
      c('2026-09-01', 'desayuno'), c('2026-08-30', 'almuerzo'),
    ];
    expect(leer(cargadas)).toEqual([
      '01 desayuno', '01 almuerzo',
      '30 desayuno', '30 almuerzo', '30 cena',
    ]);
  });

  it('cruza el cambio de mes por fecha, no por número de día', () => {
    // 29 y 30 de agosto son ANTERIORES al 01 de septiembre, aunque 29 > 01.
    const cargadas = [c('2026-09-01', 'cena'), c('2026-08-29', 'cena'), c('2026-08-30', 'cena')];
    expect(leer(cargadas).map((s) => s.slice(0, 2))).toEqual(['01', '30', '29']);
  });

  it('ordenTipoComida respeta cómo se sirve el día', () => {
    expect(ordenTipoComida('desayuno')).toBeLessThan(ordenTipoComida('almuerzo'));
    expect(ordenTipoComida('almuerzo')).toBeLessThan(ordenTipoComida('cena'));
  });

  it('un tipo desconocido o vacío va al final y no rompe el orden', () => {
    expect(ordenTipoComida(null)).toBeGreaterThan(ordenTipoComida('cena'));
    const cargadas = [
      { at: '2026-09-03T16:00:00.000Z', tipo_comida: null },
      c('2026-09-03', 'desayuno'),
    ];
    expect(leer(cargadas as ReturnType<typeof c>[])[0]).toBe('03 desayuno');
  });

  it('misma comida cargada dos veces: la más reciente arriba', () => {
    const vieja = { at: '2026-09-03T16:00:00.000Z', tipo_comida: 'almuerzo' as TipoComida };
    const nueva = { at: '2026-09-03T18:30:00.000Z', tipo_comida: 'almuerzo' as TipoComida };
    expect([vieja, nueva].sort(compararComidas)[0]).toBe(nueva);
  });

  it('tolera una comida sin fecha en vez de romperse', () => {
    const sinFecha = { at: null, tipo_comida: 'cena' as TipoComida };
    expect(() => [sinFecha, c('2026-09-03', 'cena')].sort(compararComidas)).not.toThrow();
    expect(diaDeComida(null)).toBe('');
  });
});
