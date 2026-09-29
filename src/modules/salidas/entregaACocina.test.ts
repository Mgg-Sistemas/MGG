import { describe, expect, it } from 'vitest';
import { esDestinoCocina, laDescuentaLaCocina, separarValeCocina } from './entregaACocina';
import { esCategoriaCocina, esComestible } from '@/modules/cocina/categoriasCocina';

describe('categorías de cocina', () => {
  it('lo que se come es comestible y de cocina; incluye las categorías nuevas', () => {
    for (const c of ['VIVERES', 'CARNES', 'PROTEINAS', 'HORTALIZAS Y LEGUMBRES', 'FRUTAS', 'JUGOS', 'Lácteos', 'panaderia', 'HUEVO']) {
      expect(esComestible(c), c).toBe(true);
      expect(esCategoriaCocina(c), c).toBe(true);
    }
  });

  it('la limpieza es de cocina pero NO comestible', () => {
    expect(esCategoriaCocina('LIMPIEZA')).toBe(true);
    expect(esCategoriaCocina('MATERIAL DE LIMPIEZA')).toBe(true);
    expect(esComestible('LIMPIEZA')).toBe(false);
    expect(esComestible('MATERIAL DE LIMPIEZA')).toBe(false);
  });

  it('lo que no es de cocina no cuenta', () => {
    for (const c of ['REPUESTO', 'HERRAMIENTAS', 'COCINA', '', null, undefined]) {
      expect(esComestible(c)).toBe(false);
      expect(esCategoriaCocina(c)).toBe(false);
    }
  });
});

describe('esDestinoCocina', () => {
  it('reconoce cocina y comedor sin importar tildes ni mayúsculas', () => {
    expect(esDestinoCocina('COCINA')).toBe(true);
    expect(esDestinoCocina('cocina los pinos')).toBe(true);
    expect(esDestinoCocina('Comedor La Esperanza')).toBe(true);
    expect(esDestinoCocina('MANTENIMIENTO')).toBe(false);
    expect(esDestinoCocina(null)).toBe(false);
  });
});

describe('laDescuentaLaCocina / separarValeCocina', () => {
  it('caso real: 400 salchichas a COCINA son vale; el cloro a COCINA sí descuenta', () => {
    expect(laDescuentaLaCocina('COCINA', 'CARNES')).toBe(true);
    expect(laDescuentaLaCocina('COCINA', 'LIMPIEZA')).toBe(false);
    expect(laDescuentaLaCocina('MANTENIMIENTO', 'CARNES')).toBe(false);
  });

  it('separa los renglones según la categoría del producto', () => {
    const cat = new Map([['salch', 'CARNES'], ['cloro', 'LIMPIEZA'], ['pan', 'PANADERIA']]);
    const r = separarValeCocina(
      [{ producto_id: 'salch' }, { producto_id: 'cloro' }, { producto_id: 'pan' }],
      'COCINA',
      (id) => cat.get(id),
    );
    expect(r.valeCocina.map((x) => x.producto_id)).toEqual(['salch', 'pan']);
    expect(r.descuentan.map((x) => x.producto_id)).toEqual(['cloro']);
  });

  it('a otro destino todo descuenta, aunque sea comida', () => {
    const r = separarValeCocina([{ producto_id: 'salch' }], 'CAMPAMENTO', () => 'CARNES');
    expect(r.valeCocina).toEqual([]);
    expect(r.descuentan.length).toBe(1);
  });
});
