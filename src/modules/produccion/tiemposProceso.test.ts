import { describe, it, expect } from 'vitest';
import { fmtProcesoVE, horasEntre, tiemposACompletar, vacio } from './tiemposProceso';

const fmt = (iso: string) => `F(${iso})`;

describe('la duración real de la colada', () => {
  it('cuenta las horas entre el inicio y el fin', () => {
    expect(horasEntre('2026-09-24T14:18:00Z', '2026-09-24T20:18:00Z')).toBe(6);
  });

  it('los minutos quedan en dos decimales', () => {
    // 6 minutos = 0,1 h. Es la colada de la pantalla.
    expect(horasEntre('2026-09-24T14:18:00Z', '2026-09-24T14:24:00Z')).toBe(0.1);
    expect(horasEntre('2026-09-24T14:00:00Z', '2026-09-24T14:50:00Z')).toBe(0.83);
  });

  it('sin una de las dos marcas no inventa nada', () => {
    expect(horasEntre(null, '2026-09-24T14:24:00Z')).toBeNull();
    expect(horasEntre('2026-09-24T14:18:00Z', undefined)).toBeNull();
    expect(horasEntre('no es fecha', '2026-09-24T14:24:00Z')).toBeNull();
  });

  it('una duración negativa es un dato malo, no un viaje en el tiempo', () => {
    expect(horasEntre('2026-09-24T20:00:00Z', '2026-09-24T14:00:00Z')).toBeNull();
  });
});

describe('qué campos completa el sistema', () => {
  const ini = '2026-09-24T14:18:00Z';
  const fin = '2026-09-24T14:24:00Z';

  it('llena los tres cuando el reporte está vacío', () => {
    expect(tiemposACompletar({}, ini, fin, fmt)).toEqual({
      hora_inicio_proceso: `F(${ini})`,
      hora_fin_proceso: `F(${fin})`,
      duracion_horas: 0.1,
    });
  });

  it('NO pisa lo que el usuario escribió a mano', () => {
    const patch = tiemposACompletar(
      { hora_inicio_proceso: '20/03/26 6am', duracion_horas: 12 }, ini, fin, fmt,
    );
    expect(patch.hora_inicio_proceso).toBeUndefined();
    expect(patch.duracion_horas).toBeUndefined();
    expect(patch.hora_fin_proceso).toBe(`F(${fin})`);
  });

  it('un campo con solo espacios cuenta como vacío', () => {
    expect(vacio('   ')).toBe(true);
    expect(tiemposACompletar({ hora_inicio_proceso: '  ' }, ini, fin, fmt).hora_inicio_proceso).toBe(`F(${ini})`);
  });

  it('sin fin_at solo completa el inicio', () => {
    const patch = tiemposACompletar({}, ini, null, fmt);
    expect(patch.hora_inicio_proceso).toBe(`F(${ini})`);
    expect(patch.hora_fin_proceso).toBeUndefined();
    expect(patch.duracion_horas).toBeUndefined();
  });

  it('una duración en cero es un dato cargado y se respeta', () => {
    expect(tiemposACompletar({ duracion_horas: 0 }, ini, fin, fmt).duracion_horas).toBeUndefined();
  });
});

describe('cómo se escribe la marca de tiempo en el reporte', () => {
  it('usa hora de Venezuela, no la del navegador', () => {
    // 14:24 UTC = 10:24 en Caracas (UTC−4).
    expect(fmtProcesoVE('2026-09-24T14:24:53Z')).toBe('24/09/26 10:24');
  });

  it('cruza bien la medianoche hacia atrás', () => {
    // 02:30 UTC del 24 son las 22:30 del 23 en Caracas.
    expect(fmtProcesoVE('2026-09-24T02:30:00Z')).toBe('23/09/26 22:30');
  });

  it('una fecha ilegible no ensucia el reporte', () => {
    expect(fmtProcesoVE('cualquier cosa')).toBe('');
  });
});
