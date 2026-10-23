import { describe, expect, it } from 'vitest';
import { estaEncendido } from './interruptores';

describe('un interruptor de Retenciones', () => {
  it('encendido: true, «encendido», «sí»', () => {
    for (const v of [true, 'encendido', 'Sí', 'si', 'true']) expect(estaEncendido(v)).toBe(true);
  });

  it('cualquier otra cosa lo deja apagado: lo nuevo nunca se enciende por error', () => {
    for (const v of [false, 'apagado', 'no', null, undefined, 1, {}, 'avisar']) expect(estaEncendido(v)).toBe(false);
  });
});
