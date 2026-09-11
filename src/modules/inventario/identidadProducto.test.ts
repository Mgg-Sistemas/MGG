import { describe, it, expect } from 'vitest';
import { identidadAlRecibir, tiene, descripcionDe } from './identidadProducto';

describe('la marca y el modelo al recibir la mercancía', () => {
  it('una ficha vacía toma la marca y el modelo de la orden', () => {
    // ELE-068 BOMBILLO 15 W, de SP-2026-0132.
    expect(identidadAlRecibir({ marca: null, modelo: null }, { marca: 'MARCA IGOTO', modelo: '15W' }))
      .toEqual({ marca: 'MARCA IGOTO', modelo: '15W', descripcion: 'Marca: MARCA IGOTO · Modelo: 15W' });
  });

  it('toma solo el dato que falta', () => {
    // La descripción dice TOLSEN, que es la marca que queda, no la de esta compra.
    expect(identidadAlRecibir({ marca: 'TOLSEN', modelo: null }, { marca: 'STANLEY', modelo: '18V' }))
      .toEqual({ modelo: '18V', descripcion: 'Marca: TOLSEN · Modelo: 18V' });
  });

  it('no pisa la marca que la ficha ya tenía', () => {
    // Comprar botas SAGA no puede renombrar el stock de UNDER ARMOUR.
    expect(identidadAlRecibir({ marca: 'UNDER ARMOUR' }, { marca: 'SAGA' })).toBeNull();
  });

  it('una orden sin marca no borra la de la ficha', () => {
    expect(identidadAlRecibir({ marca: 'HAMMER' }, { marca: null, modelo: null })).toBeNull();
  });

  it('sin nada que escribir devuelve null, para no hacer un UPDATE al pedo', () => {
    expect(identidadAlRecibir({}, {})).toBeNull();
    expect(identidadAlRecibir(null, null)).toBeNull();
  });

  it('los espacios no cuentan como dato', () => {
    expect(identidadAlRecibir({ marca: '   ' }, { marca: 'WEB' })).toEqual({ marca: 'WEB', descripcion: 'Marca: WEB' });
    expect(identidadAlRecibir({ marca: null }, { marca: '  ' })).toBeNull();
  });

  it('la marca se guarda sin espacios de sobra', () => {
    expect(identidadAlRecibir({}, { marca: '  JOHNPOWER ' })).toEqual({ marca: 'JOHNPOWER', descripcion: 'Marca: JOHNPOWER' });
  });

  it('solo modelo, sin marca, también sirve', () => {
    // EQE-012, de SP-2026-0069: modelo 1000, sin marca.
    expect(identidadAlRecibir({}, { modelo: '1000' })).toEqual({ modelo: '1000', descripcion: 'Modelo: 1000' });
  });

  it('tiene() distingue vacío de espacios', () => {
    expect(tiene('SAGA')).toBe(true);
    expect(tiene('')).toBe(false);
    expect(tiene('   ')).toBe(false);
    expect(tiene(null)).toBe(false);
  });
});

describe('la descripción que arma la marca y el modelo', () => {
  it('junta los dos cuando están', () => {
    expect(descripcionDe('MARCA IGOTO', '15W')).toBe('Marca: MARCA IGOTO · Modelo: 15W');
  });

  it('con uno solo no deja el separador colgando', () => {
    expect(descripcionDe('HAMMER', null)).toBe('Marca: HAMMER');
    expect(descripcionDe(null, '1000')).toBe('Modelo: 1000');
  });

  it('sin ninguno queda vacía', () => {
    expect(descripcionDe(null, null)).toBe('');
    expect(descripcionDe('  ', '')).toBe('');
  });

  it('una ficha sin descripción la recibe de la orden', () => {
    expect(identidadAlRecibir({}, { marca: 'SAGA', modelo: '42' }))
      .toEqual({ marca: 'SAGA', modelo: '42', descripcion: 'Marca: SAGA · Modelo: 42' });
  });

  it('una descripción ya escrita no se pisa', () => {
    const r = identidadAlRecibir({ descripcion: 'Bota con puntera de acero' }, { marca: 'SAGA' });
    expect(r).toEqual({ marca: 'SAGA' });
  });
});
