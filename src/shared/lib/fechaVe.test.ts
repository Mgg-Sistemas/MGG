import { describe, it, expect } from 'vitest';
import { diaValido, errorFechaVe, fechaVeValida, isoAVe, mascaraFechaVe, veAIso } from './fechaVe';

describe('de la base a la pantalla', () => {
  it('aaaa-mm-dd se muestra dd/mm/aaaa', () => {
    expect(isoAVe('1973-10-21')).toBe('21/10/1973');
  });

  it('una marca de tiempo completa también', () => {
    expect(isoAVe('1973-10-21T05:00:00Z')).toBe('21/10/1973');
  });

  it('sin fecha no muestra nada', () => {
    expect(isoAVe(null)).toBe('');
    expect(isoAVe('')).toBe('');
    expect(isoAVe('21/10/1973')).toBe('');
  });
});

describe('de la pantalla a la base', () => {
  it('dd/mm/aaaa se guarda aaaa-mm-dd', () => {
    expect(veAIso('21/10/1973')).toBe('1973-10-21');
  });

  it('el día y el mes pueden ir con un dígito', () => {
    // Quien escribe rápido pone «3/4/1990».
    expect(veAIso('3/4/1990')).toBe('1990-04-03');
  });

  it('acepta guion y punto como separador', () => {
    expect(veAIso('21-10-1973')).toBe('1973-10-21');
    expect(veAIso('21.10.1973')).toBe('1973-10-21');
  });

  it('el 3/4 es el 3 de ABRIL, no el 4 de marzo', () => {
    // Es el error que este módulo existe para evitar.
    expect(veAIso('03/04/1990')).toBe('1990-04-03');
  });

  it('una fecha incompleta todavía no es una fecha', () => {
    expect(veAIso('21/10')).toBeNull();
    expect(veAIso('21/10/73')).toBeNull();
    expect(veAIso('')).toBeNull();
  });
});

describe('los días que no existen', () => {
  it('el 31 de febrero se escribe igual de fácil que el 28', () => {
    expect(veAIso('31/02/1990')).toBeNull();
    expect(veAIso('30/02/1990')).toBeNull();
  });

  it('el 31 de abril tampoco existe', () => {
    expect(veAIso('31/04/1990')).toBeNull();
    expect(veAIso('30/04/1990')).toBe('1990-04-30');
  });

  it('el 29 de febrero depende del año', () => {
    expect(veAIso('29/02/2024')).toBe('2024-02-29');   // bisiesto
    expect(veAIso('29/02/2023')).toBeNull();
    expect(diaValido(29, 2, 2000)).toBe(true);          // 2000 es bisiesto
    expect(diaValido(29, 2, 1900)).toBe(false);         // 1900 no lo es
  });

  it('el mes 13 no existe', () => {
    expect(veAIso('01/13/1990')).toBeNull();
  });

  it('fechaVeValida contesta lo mismo, en sí o no', () => {
    expect(fechaVeValida('21/10/1973')).toBe(true);
    expect(fechaVeValida('31/02/1990')).toBe(false);
  });
});

describe('mientras se escribe', () => {
  it('pone las barras solo', () => {
    expect(mascaraFechaVe('21')).toBe('21');
    expect(mascaraFechaVe('2110')).toBe('21/10');
    expect(mascaraFechaVe('21101973')).toBe('21/10/1973');
  });

  it('no deja meter letras', () => {
    expect(mascaraFechaVe('2a1b')).toBe('21');
  });

  it('corta en ocho dígitos', () => {
    expect(mascaraFechaVe('2110197399')).toBe('21/10/1973');
  });

  it('a medio escribir no rompe: «3/» tiene que poder existir', () => {
    expect(mascaraFechaVe('3')).toBe('3');
    expect(mascaraFechaVe('')).toBe('');
  });

  it('sirve para reescribir lo que ya estaba', () => {
    expect(mascaraFechaVe('21/10/1973')).toBe('21/10/1973');
  });
});

describe('qué está mal, en palabras', () => {
  it('vacía no es un error: el campo puede ser opcional', () => {
    expect(errorFechaVe('')).toBeNull();
    expect(errorFechaVe(null)).toBeNull();
  });

  it('distingue «mal escrita» de «no existe»', () => {
    expect(errorFechaVe('21-10')).toMatch(/dd\/mm\/aaaa/);
    expect(errorFechaVe('31/02/1990')).toMatch(/no existe/i);
  });

  it('puede prohibir el futuro', () => {
    const mañana = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const [a, m, d] = mañana.split('-');
    expect(errorFechaVe(`${d}/${m}/${a}`, { futuro: false })).toMatch(/futura/i);
    expect(errorFechaVe('21/10/1973', { futuro: false })).toBeNull();
  });

  it('avisa si el año está claramente mal', () => {
    expect(errorFechaVe('21/10/1073', { minAnio: 1900 })).toMatch(/año/i);
  });

  it('una fecha buena no da error', () => {
    expect(errorFechaVe('21/10/1973')).toBeNull();
  });
});
