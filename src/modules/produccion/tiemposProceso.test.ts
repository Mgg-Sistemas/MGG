import { describe, it, expect } from 'vitest';
import { fmtPlantaVE, horasEntre, isoDePlanta, tiemposACompletar, vacio } from './tiemposProceso';

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

describe('las horas de planta que carga el operador', () => {
  it('une la fecha y la hora de la carga del horno', () => {
    expect(isoDePlanta('2026-09-24', '06:00')).toBe('2026-09-24T06:00');
  });

  it('acepta la hora escrita sin el cero de adelante', () => {
    expect(isoDePlanta('2026-09-24', '6:05')).toBe('2026-09-24T06:05');
  });

  it('sin fecha o sin hora no hay marca', () => {
    expect(isoDePlanta('2026-09-24', '')).toBeNull();
    expect(isoDePlanta('', '06:00')).toBeNull();
    expect(isoDePlanta('24/09/2026', '06:00')).toBeNull();
  });

  it('se escribe como lo pide el formato, sin correr la zona horaria', () => {
    // Es hora de planta: 06:00 tiene que salir 06:00, no 02:00 ni 10:00.
    expect(fmtPlantaVE('2026-09-24T06:00')).toBe('24/09/26 06:00');
  });

  it('una marca ilegible no ensucia el reporte', () => {
    expect(fmtPlantaVE('cualquier cosa')).toBe('');
  });

  it('de punta a punta: la carga del horno da el bloque del reporte', () => {
    const ini = isoDePlanta('2026-09-24', '06:00');
    const fin = isoDePlanta('2026-09-24', '17:30');
    expect(tiemposACompletar({}, ini, fin, fmtPlantaVE)).toEqual({
      hora_inicio_proceso: '24/09/26 06:00',
      hora_fin_proceso: '24/09/26 17:30',
      duracion_horas: 11.5,
    });
  });

  it('sin carga cargada, el bloque queda vacío en vez de inventar', () => {
    // Antes esto se llenaba con la hora en que se abrió y se cerró el
    // formulario, y el PDF salía con una colada de 0,04 h.
    expect(tiemposACompletar({}, isoDePlanta('', ''), isoDePlanta('', ''), fmtPlantaVE)).toEqual({});
  });
});
