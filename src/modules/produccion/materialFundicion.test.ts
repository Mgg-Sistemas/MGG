import { describe, it, expect } from 'vitest';
import { esMaterialDeFundicion, materialesAConsumir } from './materialFundicion';

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

describe('materialesAConsumir · qué se descuenta del inventario', () => {
  const materiales = [
    { producto_id: 'p1', material_nombre: 'CASITERITA', desde_fundicion: false },
    { producto_id: 'p2', material_nombre: 'ESTAÑO DEL PISO', desde_fundicion: true },
    { producto_id: null, material_nombre: 'REACTIVO SUELTO' },
    { producto_id: 'p3', material_nombre: 'CARBÓN' },
  ];

  it('descuenta lo que está en inventario y no vino del piso', () => {
    expect(materialesAConsumir(materiales).map((m) => m.material_nombre)).toEqual(['CASITERITA', 'CARBÓN']);
  });

  it('el material del PISO no se descuenta otra vez', () => {
    // Ya se descontó al sacarlo con «va para fundición». Descontarlo de nuevo
    // deja el inventario corto sin que nadie lo note: pasó al editar una colada.
    expect(materialesAConsumir(materiales).some((m) => m.desde_fundicion)).toBe(false);
  });

  it('el material MANUAL no se descuenta: nunca estuvo en inventario', () => {
    expect(materialesAConsumir(materiales).some((m) => !m.producto_id)).toBe(false);
  });

  it('sin la marca cargada se descuenta, que es lo normal', () => {
    expect(materialesAConsumir([{ producto_id: 'p9' }])).toHaveLength(1);
  });

  it('una lista vacía o ausente no rompe', () => {
    expect(materialesAConsumir([])).toEqual([]);
  });
});
