import { describe, it, expect } from 'vitest';
import { textoDeError } from './errores';

describe('el texto de un error', () => {
  it('un Error normal habla por sí solo', () => {
    expect(textoDeError(new Error('Stock insuficiente'), 'respaldo')).toBe('Stock insuficiente');
  });

  it('un error de Supabase ya no se pierde: no es un Error, es un objeto plano', () => {
    const e = { message: 'duplicate key value', details: 'Key (id)=(7) already exists.', hint: null, code: '23505' };
    expect(textoDeError(e, 'No se pudo recibir la compra directa.'))
      .toBe('duplicate key value · Key (id)=(7) already exists. [23505]');
  });

  it('con solo el código, al menos queda el código para buscarlo', () => {
    expect(textoDeError({ code: '42501' }, 'No se pudo guardar.')).toBe('No se pudo guardar. [42501]');
  });

  it('un texto suelto sirve como mensaje', () => {
    expect(textoDeError('se cayó la red', 'respaldo')).toBe('se cayó la red');
  });

  it('sin nada que decir, se usa el respaldo', () => {
    expect(textoDeError(null, 'No se pudo recibir la compra directa.')).toBe('No se pudo recibir la compra directa.');
    expect(textoDeError(new Error('   '), 'respaldo')).toBe('respaldo');
    expect(textoDeError({}, 'respaldo')).toBe('respaldo');
  });
});
