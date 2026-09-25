import { describe, it, expect } from 'vitest';
import {
  MAX_DETALLE_QR, MAX_DETALLE_SALUD, errorCondicionesSalud, hayCondiciones, lineasSaludQR,
  normalizarSalud, renglonesSalud, saludCargada, textoRespuesta,
} from './condicionesSalud';

describe('las tres respuestas posibles', () => {
  it('sí, no, y «todavía no se preguntó»', () => {
    expect(textoRespuesta(true)).toBe('Sí');
    expect(textoRespuesta(false)).toBe('No');
    expect(textoRespuesta(null)).toBe('—');
    expect(textoRespuesta(undefined)).toBe('—');
  });

  it('una ficha vieja no dice «no tiene alergias»: dice que no se sabe', () => {
    // Si el null se tratara como false, una ficha que nadie completó afirmaría
    // algo que nadie contestó, y en una emergencia se leería como confirmado.
    expect(saludCargada({})).toBe(false);
    expect(saludCargada({ tiene_alergias: false })).toBe(true);
  });
});

describe('el detalle solo vive mientras la respuesta sea «sí»', () => {
  it('con «sí» se conserva', () => {
    const c = normalizarSalud({ tiene_alergias: true, alergias_detalle: '  Penicilina  ' });
    expect(c.alergias_detalle).toBe('Penicilina');
  });

  it('al pasar a «no» se borra: si no, el QR seguiría mostrando la alergia vieja', () => {
    const c = normalizarSalud({ tiene_alergias: false, alergias_detalle: 'Penicilina' });
    expect(c.alergias_detalle).toBeNull();
  });

  it('sin respuesta tampoco queda detalle', () => {
    const c = normalizarSalud({ tiene_enfermedad: null, enfermedad_detalle: 'Asma' });
    expect(c.tiene_enfermedad).toBeNull();
    expect(c.enfermedad_detalle).toBeNull();
  });

  it('un detalle en blanco no se guarda como cadena vacía', () => {
    expect(normalizarSalud({ tiene_alergias: true, alergias_detalle: '   ' }).alergias_detalle).toBeNull();
  });

  it('un detalle larguísimo se corta: es un renglón de carnet, no una historia clínica', () => {
    const largo = 'a'.repeat(MAX_DETALLE_SALUD + 50);
    const c = normalizarSalud({ tiene_enfermedad: true, enfermedad_detalle: largo });
    expect(c.enfermedad_detalle).toHaveLength(MAX_DETALLE_SALUD);
  });

  it('una ficha vacía se normaliza sin romperse', () => {
    expect(normalizarSalud({})).toEqual({
      tiene_alergias: null, alergias_detalle: null, tiene_enfermedad: null, enfermedad_detalle: null,
    });
  });
});

describe('qué se acepta al guardar', () => {
  it('«sí» sin decir a qué no pasa', () => {
    expect(errorCondicionesSalud({ tiene_alergias: true })).toContain('alérgico');
    expect(errorCondicionesSalud({ tiene_enfermedad: true, enfermedad_detalle: '  ' })).toContain('enfermedad');
  });

  it('un detalle de dos letras no dice nada', () => {
    expect(errorCondicionesSalud({ tiene_alergias: true, alergias_detalle: 'ab' })).toContain('3 caracteres');
  });

  it('«sí» con detalle pasa', () => {
    expect(errorCondicionesSalud({ tiene_alergias: true, alergias_detalle: 'Penicilina' })).toBeNull();
  });

  it('«no» y «sin preguntar» pasan sin detalle', () => {
    expect(errorCondicionesSalud({ tiene_alergias: false, tiene_enfermedad: false })).toBeNull();
    expect(errorCondicionesSalud({})).toBeNull();
  });
});

describe('cómo se lee en la ficha técnica', () => {
  it('el detalle va pegado a la respuesta', () => {
    const r = renglonesSalud({ tiene_alergias: true, alergias_detalle: 'Penicilina', tiene_enfermedad: false });
    expect(r).toEqual([
      { etiqueta: 'Alergias', valor: 'Sí · Penicilina' },
      { etiqueta: 'Enfermedad', valor: 'No' },
    ]);
  });

  it('sin cargar, los dos renglones muestran el guion', () => {
    expect(renglonesSalud({}).map((x) => x.valor)).toEqual(['—', '—']);
  });
});

describe('lo que se ve al escanear el QR', () => {
  it('solo aparece lo que hay que declarar', () => {
    // Dos «No» en un QR de carnet solo le quitan lugar a lo que importa.
    expect(lineasSaludQR({ tiene_alergias: false, tiene_enfermedad: false })).toEqual([]);
    expect(lineasSaludQR({})).toEqual([]);
    expect(hayCondiciones({ tiene_alergias: false })).toBe(false);
  });

  it('la alergia sale en mayúsculas, para que salte a la vista', () => {
    expect(lineasSaludQR({ tiene_alergias: true, alergias_detalle: 'Penicilina' }))
      .toEqual(['ALERGIAS: Penicilina']);
  });

  it('las dos condiciones salen juntas', () => {
    const l = lineasSaludQR({
      tiene_alergias: true, alergias_detalle: 'Penicilina',
      tiene_enfermedad: true, enfermedad_detalle: 'Asma',
    });
    expect(l).toEqual(['ALERGIAS: Penicilina', 'ENFERMEDAD: Asma']);
  });

  it('un detalle largo se corta: si no, el QR se agranda y deja de leerse impreso', () => {
    const l = lineasSaludQR({ tiene_alergias: true, alergias_detalle: 'x'.repeat(200) });
    expect(l[0].length).toBeLessThanOrEqual('ALERGIAS: '.length + MAX_DETALLE_QR);
    expect(l[0].endsWith('…')).toBe(true);
  });

  it('«sí» sin detalle igual avisa, no se calla', () => {
    expect(lineasSaludQR({ tiene_alergias: true })).toEqual(['ALERGIAS: sí (sin detalle)']);
  });
});
