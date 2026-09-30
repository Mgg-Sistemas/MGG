import { describe, expect, it } from 'vitest';
import { cocinaDelDestino, esDestinoCocina, laDescuentaLaCocina, repartirEntregaCocina, separarValeCocina } from './entregaACocina';
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
  it('REGLA FIJADA POR LA ADMINISTRADORA (30-09): en Los Pinos y La Esperanza lo de Alimentación no baja por Salidas; en el resguardo sí', () => {
    expect(laDescuentaLaCocina('COCINA', 'CARNES')).toBe(true);
    expect(laDescuentaLaCocina('COCINA', 'LIMPIEZA')).toBe(true);
    expect(laDescuentaLaCocina('MANTENIMIENTO', 'CARNES', 'LOS PINOS')).toBe(true);
    expect(laDescuentaLaCocina('COCINA', 'LIMPIEZA', 'CENTRO DE ACOPIO - LA ESPERANZA')).toBe(true);
    expect(laDescuentaLaCocina('COCINA', 'VIVERES', 'CENTRO DE FUNDICION - MATANZAS')).toBe(false);
    expect(laDescuentaLaCocina('COCINA', 'PLOMERIA', 'LOS PINOS')).toBe(false);
  });

  it('separa los renglones según la categoría del producto', () => {
    const cat = new Map([['salch', 'CARNES'], ['cloro', 'LIMPIEZA'], ['pan', 'PANADERIA']]);
    const r = separarValeCocina(
      [{ producto_id: 'salch' }, { producto_id: 'cloro' }, { producto_id: 'pan' }],
      'COCINA',
      (id) => cat.get(id),
    );
    expect(r.valeCocina.map((x) => x.producto_id)).toEqual(['salch', 'cloro', 'pan']);
    expect(r.descuentan).toEqual([]);
  });

  it('caso real SAL-2026-0247: de Los Pinos a otra cocina nada de Alimentación se traslada ni descuenta', () => {
    const cocinas = [{ nombre: 'Los Pinos', almacen: 'Los Pinos' }, { nombre: 'La Esperanza', almacen: 'La Esperanza' }];
    const cat = new Map([['aji', 'VIVERES'], ['cloro', 'LIMPIEZA']]);
    const r = repartirEntregaCocina(
      [{ producto_id: 'aji' }, { producto_id: 'cloro' }],
      { destino: 'CENTRO DE ACOPIO LA ESPERANZA', sedeDestino: 'Centro de Acopio LA ESPERANZA', almacenOrigen: 'Los Pinos' },
      cocinas, (id) => cat.get(id),
    );
    expect(r.cocina?.almacen).toBe('La Esperanza');
    expect(r.trasladan).toEqual([]);
    expect(r.valeCocina.map((x) => x.producto_id)).toEqual(['aji', 'cloro']);
    expect(r.descuentan).toEqual([]);
  });

  it('reconoce la cocina por su nombre, su almacén, su sede o sin artículo', () => {
    const cocinas = [{ nombre: 'La Esperanza', almacen: 'La Esperanza', sede: 'CENTRO DE ACOPIO - LA ESPERANZA' }];
    for (const d of ['COCINA ESPERANZA', 'Comedor de la Esperanza', 'CENTRO DE ACOPIO - LA ESPERANZA', 'esperanza']) {
      expect(cocinaDelDestino(d, null, cocinas)?.almacen, d).toBe('La Esperanza');
    }
    expect(cocinaDelDestino('MANTENIMIENTO', 'Centro de Acopio LA ESPERANZA', cocinas)?.almacen).toBe('La Esperanza');
    expect(cocinaDelDestino('TALLER', 'BASE LA GUAIRA', cocinas)).toBeNull();
  });

  it('de Los Pinos al resguardo no viaja ni descuenta; desde el RESGUARDO (Matanzas) sí descuenta', () => {
    const cocinas = [{ nombre: 'Resguardo Matanzas', almacen: 'Resguardo', sede: 'CENTRO DE FUNDICION - MATANZAS' }];
    const va = repartirEntregaCocina([{ producto_id: 'arroz' }],
      { destino: 'RESGUARDO', almacenOrigen: 'Los Pinos', sedeOrigen: 'LOS PINOS' }, cocinas, () => 'VIVERES');
    expect(va.trasladan).toEqual([]);
    expect(va.valeCocina.length).toBe(1);
    const queda = repartirEntregaCocina([{ producto_id: 'arroz' }],
      { destino: 'PERSONAL', sedeDestino: 'CENTRO DE FUNDICION - MATANZAS', almacenOrigen: 'General', sedeOrigen: 'CENTRO DE FUNDICION - MATANZAS' },
      cocinas, () => 'VIVERES');
    expect(queda.trasladan).toEqual([]);
    expect(queda.descuentan.length).toBe(1);
    expect(queda.valeCocina).toEqual([]);
  });

  it('a la cocina de la MISMA sede sigue siendo vale, no traslado', () => {
    const cocinas = [{ nombre: 'Los Pinos', almacen: 'Los Pinos' }];
    const r = repartirEntregaCocina([{ producto_id: 'papa' }],
      { destino: 'COCINA', sedeDestino: 'Los Pinos', almacenOrigen: 'Los Pinos' }, cocinas, () => 'HORTALIZAS Y LEGUMBRES');
    expect(r.trasladan).toEqual([]);
    expect(r.valeCocina.length).toBe(1);
    expect(cocinaDelDestino('BASE LA GUAIRA', null, cocinas)).toBeNull();
  });

  it('a otro destino la comida tampoco descuenta; lo que no es comida sí', () => {
    const r = separarValeCocina([{ producto_id: 'salch' }, { producto_id: 'tubo' }], 'CAMPAMENTO', (id) => (id === 'salch' ? 'CARNES' : 'PLOMERIA'));
    expect(r.valeCocina.map((x) => x.producto_id)).toEqual(['salch']);
    expect(r.descuentan.map((x) => x.producto_id)).toEqual(['tubo']);
  });
});
