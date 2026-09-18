import { describe, expect, it } from 'vitest';
import { aHora24, horaLegible } from './hora';

describe('aHora24', () => {
  it('entiende lo que se escribía a mano', () => {
    expect(aHora24('8:30PM')).toBe('20:30');
    expect(aHora24('8:30 pm')).toBe('20:30');
    expect(aHora24('6am')).toBe('06:00');
    expect(aHora24('12:15am')).toBe('00:15');
    expect(aHora24('12:15 p.m.')).toBe('12:15');
    expect(aHora24('20:30')).toBe('20:30');
    expect(aHora24('7.05')).toBe('07:05');
  });
  it('no inventa una hora de algo que no lo es', () => {
    expect(aHora24('')).toBe('');
    expect(aHora24(null)).toBe('');
    expect(aHora24('8')).toBe('');
    expect(aHora24('25:00')).toBe('');
    expect(aHora24('13pm')).toBe('');
    expect(aHora24('20/03/26 6am')).toBe('');
  });
});

describe('horaLegible', () => {
  it('muestra en 12 h', () => {
    expect(horaLegible('20:30')).toBe('8:30 pm');
    expect(horaLegible('00:05')).toBe('12:05 am');
    expect(horaLegible('8:30PM')).toBe('8:30 pm');
  });
  it('lo que no se reconoce se muestra tal cual', () => {
    expect(horaLegible('al amanecer')).toBe('al amanecer');
    expect(horaLegible(undefined)).toBe('');
  });
});
