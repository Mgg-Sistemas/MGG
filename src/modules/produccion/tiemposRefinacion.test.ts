import { describe, expect, it } from 'vitest';
import { fechaHoraLegible, tiemposRefinacion } from './tiemposRefinacion';

describe('fechaHoraLegible', () => {
  it('arma la hora en 12 h con la fecha corta', () => {
    expect(fechaHoraLegible('2026-03-28', '16:29')).toBe('4:29 pm 28/03/26');
    expect(fechaHoraLegible('2026-03-28', '00:05')).toBe('12:05 am 28/03/26');
    expect(fechaHoraLegible('2026-03-28', '12:00')).toBe('12:00 pm 28/03/26');
  });
  it('devuelve vacío si falta la fecha o la hora', () => {
    expect(fechaHoraLegible('', '16:29')).toBe('');
    expect(fechaHoraLegible('2026-03-28', '')).toBe('');
    expect(fechaHoraLegible(undefined, undefined)).toBe('');
  });
});

describe('tiemposRefinacion', () => {
  it('toma inicio, fin y total de la jornada cargada al crear: no se vuelven a pedir', () => {
    const t = tiemposRefinacion({
      fecha_inicio_jornada: '2026-03-28', hora_inicio_jornada: '16:29',
      fecha_fin_jornada: '2026-03-28', hora_fin_jornada: '19:20', jornada_horas: 2.85,
    });
    expect(t).toEqual({ inicio: '4:29 pm 28/03/26', fin: '7:20 pm 28/03/26', totalHoras: 2.85, delReporte: true });
  });

  it('respeta lo que ya se guardó al finalizar en registros viejos', () => {
    const t = tiemposRefinacion({
      fecha_inicio_jornada: '2026-03-28', hora_inicio_jornada: '16:29',
      hora_inicio_refinacion: '5:00pm 28/03/26', tiempo_total_horas: 3,
    });
    expect(t.inicio).toBe('5:00pm 28/03/26');
    expect(t.totalHoras).toBe(3);
    expect(t.delReporte).toBe(true);
  });

  it('sin jornada cargada queda vacío y hay que pedirlo al finalizar', () => {
    expect(tiemposRefinacion({})).toEqual({ inicio: '', fin: '', totalHoras: null, delReporte: false });
    expect(tiemposRefinacion(null).delReporte).toBe(false);
  });
});
