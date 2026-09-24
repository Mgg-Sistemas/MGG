import { describe, it, expect } from 'vitest';
import { rotuloOrigenTiempos, tiemposDeLaOrden } from './tiemposDeLaOrden';

const SISTEMA_INI = '2026-09-24T15:40:00Z';
const SISTEMA_FIN = '2026-09-24T15:43:00Z';

describe('qué horas muestra la tarjeta de una colada', () => {
  it('usa la carga del horno, no el rato que estuvo abierto el formulario', () => {
    // Es la colada 6: se trabajó el 10/08 de 11:50 a 21:20, y se cargó al
    // sistema el 24/09 entre las 11:40 y las 11:43.
    expect(tiemposDeLaOrden({
      fecha_inicio_carga: '2026-08-10', hora_inicio_carga: '11:50',
      fecha_fin_carga: '2026-08-10', hora_fin_carga: '21:20',
    }, SISTEMA_INI, SISTEMA_FIN)).toEqual({
      inicio: '2026-08-10T11:50', fin: '2026-08-10T21:20', dePlanta: true,
    });
  });

  it('la refinación usa su jornada', () => {
    expect(tiemposDeLaOrden({
      fecha_inicio_jornada: '2026-03-28', hora_inicio_jornada: '06:00',
      fecha_fin_jornada: '2026-03-28', hora_fin_jornada: '16:29',
    }, SISTEMA_INI, SISTEMA_FIN)).toEqual({
      inicio: '2026-03-28T06:00', fin: '2026-03-28T16:29', dePlanta: true,
    });
  });

  it('una colada que cruza la medianoche se lee entera', () => {
    const t = tiemposDeLaOrden({
      fecha_inicio_carga: '2026-08-09', hora_inicio_carga: '18:00',
      fecha_fin_carga: '2026-08-10', hora_fin_carga: '01:42',
    }, SISTEMA_INI, SISTEMA_FIN);
    expect(t).toMatchObject({ inicio: '2026-08-09T18:00', fin: '2026-08-10T01:42', dePlanta: true });
  });
});

describe('cuándo se cae a las horas del sistema', () => {
  it('sin nada cargado, muestra las de la orden', () => {
    expect(tiemposDeLaOrden({}, SISTEMA_INI, SISTEMA_FIN))
      .toEqual({ inicio: SISTEMA_INI, fin: SISTEMA_FIN, dePlanta: false });
    expect(tiemposDeLaOrden(null, SISTEMA_INI, SISTEMA_FIN).dePlanta).toBe(false);
  });

  it('con SOLO el inicio de planta no se mezcla con el fin del sistema', () => {
    // Mezclarlos daría «arrancó ayer a las 18:00 y terminó hoy a las 11:43».
    const t = tiemposDeLaOrden(
      { fecha_inicio_carga: '2026-08-10', hora_inicio_carga: '11:50' }, SISTEMA_INI, SISTEMA_FIN,
    );
    expect(t).toEqual({ inicio: SISTEMA_INI, fin: SISTEMA_FIN, dePlanta: false });
  });

  it('un fin anterior al inicio es un dato mal cargado, no se usa', () => {
    const t = tiemposDeLaOrden({
      fecha_inicio_carga: '2026-08-10', hora_inicio_carga: '21:20',
      fecha_fin_carga: '2026-08-10', hora_fin_carga: '11:50',
    }, SISTEMA_INI, SISTEMA_FIN);
    expect(t.dePlanta).toBe(false);
  });

  it('una orden en curso sin fin se muestra como está', () => {
    expect(tiemposDeLaOrden({}, SISTEMA_INI, null)).toEqual({ inicio: SISTEMA_INI, fin: null, dePlanta: false });
  });
});

describe('el rótulo dice de dónde salieron las horas', () => {
  it('lo aclara en los dos casos', () => {
    expect(rotuloOrigenTiempos(true)).toContain('planta');
    expect(rotuloOrigenTiempos(false)).toContain('sistema');
  });
});
