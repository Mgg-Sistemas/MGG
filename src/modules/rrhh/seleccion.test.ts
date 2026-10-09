import { describe, it, expect } from 'vitest';
import { alternar, desmarcarVisibles, marcarVisibles, todosMarcados } from './seleccion';

describe('marcar / desmarcar sobre lo visible', () => {
  it('marcar visibles suma sin perder lo que ya estaba', () => {
    const out = marcarVisibles(new Set(['a']), ['b', 'c']);
    expect([...out].sort()).toEqual(['a', 'b', 'c']);
  });
  it('desmarcar visibles saca solo esos', () => {
    const out = desmarcarVisibles(new Set(['a', 'b', 'c']), ['b']);
    expect([...out].sort()).toEqual(['a', 'c']);
  });
  it('no muta el set original', () => {
    const s = new Set(['a']);
    marcarVisibles(s, ['b']); desmarcarVisibles(s, ['a']); alternar(s, 'z');
    expect([...s]).toEqual(['a']);
  });
  it('alternar de a uno sigue funcionando', () => {
    expect(alternar(new Set(['a']), 'a').size).toBe(0);
    expect(alternar(new Set(['a']), 'b').has('b')).toBe(true);
  });
  it('todosMarcados mira solo los visibles', () => {
    expect(todosMarcados(new Set(['a', 'b']), ['a'])).toBe(true);
    expect(todosMarcados(new Set(['a']), ['a', 'b'])).toBe(false);
    expect(todosMarcados(new Set(['a']), [])).toBe(false);
  });
});
