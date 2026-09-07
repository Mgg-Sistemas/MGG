import { describe, it, expect } from 'vitest';
import { esMaterialDeFundicion } from './materialFundicion';

describe('esMaterialDeFundicion · qué puede ir al piso de fundición', () => {
  it('toda la materia prima entra, esté o no marcada como receta', () => {
    // Este era el caso roto: MP-001 es materia prima pero nadie lo marcó, así que
    // el check no aparecía en Salidas y tampoco se podía usar en una colada.
    expect(esMaterialDeFundicion({ categoria: 'MP', es_receta: false })).toBe(true);
    expect(esMaterialDeFundicion({ categoria: 'MP', es_receta: null })).toBe(true);
    expect(esMaterialDeFundicion({ categoria: 'MP' })).toBe(true);
  });

  it('la marca manual de receta suma, aunque la categoría sea otra', () => {
    // Un reactivo de refinación puede no estar catalogado como MP.
    expect(esMaterialDeFundicion({ categoria: 'INS', es_receta: true })).toBe(true);
  });

  it('lo que no es ninguna de las dos cosas queda afuera', () => {
    expect(esMaterialDeFundicion({ categoria: 'INS', es_receta: false })).toBe(false);
    expect(esMaterialDeFundicion({ categoria: 'VIV', es_receta: null })).toBe(false);
    expect(esMaterialDeFundicion({})).toBe(false);
  });

  it('no se cae con una ficha ausente', () => {
    expect(esMaterialDeFundicion(null)).toBe(false);
    expect(esMaterialDeFundicion(undefined)).toBe(false);
  });

  it('la categoría se compara sin importar espacios ni mayúsculas', () => {
    expect(esMaterialDeFundicion({ categoria: ' mp ' })).toBe(true);
    expect(esMaterialDeFundicion({ categoria: 'Mp' })).toBe(true);
  });

  it('no confunde una categoría que apenas empieza con MP', () => {
    expect(esMaterialDeFundicion({ categoria: 'MPX' })).toBe(false);
    expect(esMaterialDeFundicion({ categoria: 'EMPAQUE' })).toBe(false);
  });
});
