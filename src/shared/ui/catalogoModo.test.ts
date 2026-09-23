import { describe, it, expect } from 'vitest';
import { modoCatalogo, opcionesConGuardada, TOPE_CHIPS } from './catalogoModo';

describe('modoCatalogo', () => {
  it('con pocas opciones las muestra todas como chips', () => {
    expect(modoCatalogo(0)).toBe('chips');
    expect(modoCatalogo(2)).toBe('chips');   // CARBOMORCA y CIVCA
    expect(modoCatalogo(4)).toBe('chips');
  });

  it('desde cinco pasa a buscador', () => {
    expect(modoCatalogo(TOPE_CHIPS)).toBe('buscador');
    expect(modoCatalogo(5)).toBe('buscador');
    expect(modoCatalogo(40)).toBe('buscador');
  });

  it('el corte es exactamente en cinco', () => {
    expect(modoCatalogo(TOPE_CHIPS - 1)).toBe('chips');
    expect(modoCatalogo(TOPE_CHIPS)).toBe('buscador');
  });
});

describe('opcionesConGuardada', () => {
  const cat = ['CARBOMORCA', 'CIVCA'];

  it('deja la lista igual cuando lo guardado ya está', () => {
    expect(opcionesConGuardada(cat, 'CIVCA')).toEqual(cat);
  });

  it('no distingue mayúsculas para decidir si ya está', () => {
    expect(opcionesConGuardada(cat, 'civca')).toEqual(cat);
  });

  it('suma lo guardado cuando lo dieron de baja del catálogo', () => {
    expect(opcionesConGuardada(cat, 'COQUES DEL SUR')).toEqual([...cat, 'COQUES DEL SUR']);
  });

  it('sin valor guardado devuelve el catálogo tal cual', () => {
    expect(opcionesConGuardada(cat, null)).toEqual(cat);
    expect(opcionesConGuardada(cat, '')).toEqual(cat);
    expect(opcionesConGuardada(cat, '   ')).toEqual(cat);
  });

  it('un catálogo de cuatro más lo guardado dado de baja ya va a buscador', () => {
    const cuatro = ['A', 'B', 'C', 'D'];
    const conVieja = opcionesConGuardada(cuatro, 'VIEJA');
    expect(conVieja).toHaveLength(5);
    expect(modoCatalogo(conVieja.length)).toBe('buscador');
  });
});
