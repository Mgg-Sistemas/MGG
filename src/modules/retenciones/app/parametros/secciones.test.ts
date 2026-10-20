import { describe, expect, it } from 'vitest';
import { AVISO_AVANZADOS, CADENA, seccionesDe } from './secciones';

describe('las secciones de ⚙ Parámetros, en el orden de la maqueta (v8-2-ajustes.js)', () => {
  it('Ajustes, en local: las ocho tarjetas, y solo «Datos de la empresa» con datos hoy', () => {
    const xs = seccionesDe('ajustes', true);
    expect(xs.map((s) => s.clave)).toEqual(['motivos', 'entes', 'perfiles', 'licencias', 'empresa', 'firma', 'otro', 'vencimientos']);
    expect(xs.filter((s) => s.vista).map((s) => s.clave)).toEqual(['empresa']);
  });

  it('en producción, solo las que tienen datos: nada a medias', () => {
    expect(seccionesDe('ajustes', false).map((s) => s.clave)).toEqual(['empresa']);
    expect(seccionesDe('impuesto', false).map((s) => s.clave)).toEqual(['impuestos']);
    expect(seccionesDe('empresa', false).map((s) => s.clave)).toEqual(['regimen', 'valores']);
  });

  it('Ajustes avanzados: «Cada impuesto» y «De toda la empresa»', () => {
    expect(seccionesDe('impuesto', true).map((s) => s.clave)).toEqual(['impuestos', 'formatos', 'convivencia']);
    expect(seccionesDe('empresa', true).map((s) => s.clave)).toEqual(['regimen', 'valores', 'interruptores']);
  });

  it('cada tarjeta lleva su título y su línea de la maqueta', () => {
    const regimen = seccionesDe('empresa', true).find((s) => s.clave === 'regimen');
    expect(regimen).toMatchObject({ titulo: 'Régimen fiscal de la empresa', linea: 'Agente de retención de IVA y contribuyente especial: desde cuándo, con motivo.' });
    for (const s of [...seccionesDe('ajustes', true), ...seccionesDe('impuesto', true), ...seccionesDe('empresa', true)]) {
      expect(s.titulo).not.toBe('');
      expect(s.linea).not.toBe('');
    }
  });

  it('el aviso de los avanzados y la cadena, con los textos de la maqueta', () => {
    expect(AVISO_AVANZADOS).toBe('Estos cambios afectan cálculos, números o fechas de declaración. Lo ya emitido no cambia.');
    expect(CADENA.map(([t]) => t)).toEqual(['Empresa', 'Impuesto', 'Regla y vigencia', 'Período y numeración', 'Formato']);
  });
});
