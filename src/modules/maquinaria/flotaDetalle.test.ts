import { describe, it, expect } from 'vitest';
import { bloquesNotas, documentoInforme, esEventoInforme, imagenesDocumentos, resumenEvento, ultimoEventoPorEquipo } from './flotaDetalle';

describe('esEventoInforme', () => {
  it('reconoce la nota que deja la carga de informes técnicos', () => {
    expect(esEventoInforme({ nota: 'Carga de informes técnicos en PDF', actor: 'sistema' })).toBe(true);
    expect(esEventoInforme({ nota: 'CARGA DE INFORMES TECNICOS EN PDF' })).toBe(true);
  });
  it('reconoce el motivo que cita el informe con su fecha', () => {
    expect(esEventoInforme({ motivo: 'Motor malo y aire acondicionado malo; componentes desmontados (informe técnico 09/10/2026)' })).toBe(true);
  });
  it('un cambio de estado cualquiera no es del informe', () => {
    expect(esEventoInforme({ motivo: 'Se le reventó una manguera', nota: 'revisar mañana' })).toBe(false);
    expect(esEventoInforme({ motivo: 'Falta el informe del mecánico' })).toBe(false);
    expect(esEventoInforme(null)).toBe(false);
  });
});

describe('documentoInforme', () => {
  const foto = { nombre: 'FOTO DEL EQUIPO', content_type: 'image/jpeg', espacio: 1 };
  const placa = { nombre: 'FOTO DE LA PLACA', content_type: 'image/jpeg', espacio: 2 };
  const informe = { nombre: 'INFORME TÉCNICO', content_type: 'application/pdf', espacio: 3 };
  it('encuentra el PDF «INFORME TÉCNICO»', () => {
    expect(documentoInforme([foto, placa, informe])).toBe(informe);
  });
  it('si se llama distinto, sirve cualquier PDF que diga «informe»', () => {
    const otro = { nombre: 'INFORME DE REVISIÓN', content_type: null, archivo: 'rev.pdf' };
    expect(documentoInforme([foto, otro])).toBe(otro);
  });
  it('sin informe devuelve null (una imagen llamada informe no cuenta)', () => {
    expect(documentoInforme([foto, { nombre: 'INFORME', content_type: 'image/png' }])).toBeNull();
  });
  it('las imágenes salen en el orden de sus espacios', () => {
    expect(imagenesDocumentos([informe, placa, foto])).toEqual([foto, placa]);
  });
});

describe('bloquesNotas', () => {
  it('separa la cabecera del informe y pone una oración por línea', () => {
    const b = bloquesNotas('INFORME TÉCNICO (recibido 09/10/2026): OPERATIVO. Horómetro 12,302.0 h (panel). Temperatura 30 °C, batería 23.6 V.');
    expect(b).toHaveLength(1);
    expect(b[0].titulo).toBe('Informe técnico · recibido 09/10/2026');
    expect(b[0].lineas).toEqual(['OPERATIVO.', 'Horómetro 12,302.0 h (panel).', 'Temperatura 30 °C, batería 23.6 V.']);
  });
  it('no parte abreviaturas ni números', () => {
    const b = bloquesNotas('Motor C4Z05524, n.º de arreglo 3217704, 70.0 kW.');
    expect(b[0].lineas).toEqual(['Motor C4Z05524, n.º de arreglo 3217704, 70.0 kW.']);
  });
  it('respeta los párrafos que ya tenían las notas', () => {
    const b = bloquesNotas('Comprado en 2020.\n\nINFORME TÉCNICO (recibido 09/10/2026): «Articulado 1 Volvo». 100% OPERATIVO.');
    expect(b).toHaveLength(2);
    expect(b[0]).toEqual({ titulo: null, lineas: ['Comprado en 2020.'] });
    expect(b[1].lineas).toEqual(['«Articulado 1 Volvo».', '100% OPERATIVO.']);
  });
  it('sin notas no hay bloques', () => {
    expect(bloquesNotas(null)).toEqual([]);
    expect(bloquesNotas('   ')).toEqual([]);
  });
});

describe('resumen y último evento', () => {
  it('junta motivo, material, nota y quién, sin vacíos', () => {
    expect(resumenEvento({ motivo: 'Averiado', material: 'solenoide', nota: 'Carga de informes técnicos en PDF', actor: 'sistema', actor_name: null }))
      .toBe('Averiado · falta solenoide · Carga de informes técnicos en PDF · sistema');
    expect(resumenEvento({ motivo: '', actor_name: 'Ana' })).toBe('Ana');
  });
  it('toma el evento más reciente de cada equipo', () => {
    const m = ultimoEventoPorEquipo([
      { equipo_id: 'a', created_at: '2026-10-01T10:00:00Z', n: 1 },
      { equipo_id: 'a', created_at: '2026-10-09T10:00:00Z', n: 2 },
      { equipo_id: 'b', created_at: '2026-10-05T10:00:00Z', n: 3 },
    ]);
    expect(m.get('a')?.n).toBe(2);
    expect(m.get('b')?.n).toBe(3);
  });
});
