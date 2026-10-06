import { describe, expect, it } from 'vitest';
import { esRolDeTelefono, rutaDeInicio, vistasTelefonoDe } from './permisos.repository';

describe('vistas de teléfono según permisos (02-10)', () => {
  it('surtidor y cocina son roles de teléfono; los demás no', () => {
    expect(esRolDeTelefono('combustible')).toBe(true);
    expect(esRolDeTelefono('cocina')).toBe(true);
    expect(esRolDeTelefono('admin')).toBe(false);
    expect(esRolDeTelefono(null)).toBe(false);
  });

  it('un surtidor con Combustible y Alimentación ve las dos, la suya primero', () => {
    expect(vistasTelefonoDe('combustible', ['cocina', 'combustible']).map((v) => v.ruta))
      .toEqual(['combustible/surtidor', 'cocina/telefono']);
  });

  it('un cocinero con las dos ve primero comidas', () => {
    expect(vistasTelefonoDe('cocina', ['combustible', 'cocina']).map((v) => v.ruta))
      .toEqual(['cocina/telefono', 'combustible/surtidor']);
  });

  it('solo las que tiene permitidas', () => {
    expect(vistasTelefonoDe('cocina', ['cocina']).map((v) => v.ruta)).toEqual(['cocina/telefono']);
    expect(vistasTelefonoDe('cocina', ['acopio'])).toEqual([]);
  });

  it('un rol de escritorio con los dos módulos también las tiene (para los atajos)', () => {
    expect(vistasTelefonoDe('admin', ['combustible', 'cocina']).length).toBe(2);
  });

  it('el inicio: a su vista; sin permiso de la suya, a la otra vista de teléfono; sin ninguna, al primer módulo', () => {
    expect(rutaDeInicio('combustible', ['cocina', 'combustible'])).toBe('/app/combustible/surtidor');
    expect(rutaDeInicio('combustible', ['cocina'])).toBe('/app/cocina/telefono');
    expect(rutaDeInicio('cocina', ['combustible', 'cocina'])).toBe('/app/cocina/telefono');
    expect(rutaDeInicio('cocina', ['acopio'])).toBe('/app/acopio');
    expect(rutaDeInicio('admin', ['combustible', 'cocina'])).toBe('/app/combustible');
    expect(rutaDeInicio('cocina', [])).toBe('/app/sin-acceso');
  });

  it('la marca «solo teléfono» del rol manda sobre el nombre', () => {
    // Un rol nuevo, con cualquier nombre, marcado solo teléfono: entra al celular.
    expect(rutaDeInicio('planta_movil', ['combustible', 'cocina'], true)).toBe('/app/combustible/surtidor');
    expect(rutaDeInicio('planta_movil', ['cocina'], true)).toBe('/app/cocina/telefono');
    // Y al revés: un rol que se llama cocina pero le quitaron la marca va al escritorio.
    expect(rutaDeInicio('cocina', ['cocina'], false)).toBe('/app/cocina');
    // Sin marca leída (null) cae al nombre.
    expect(rutaDeInicio('cocina', ['cocina'], null)).toBe('/app/cocina/telefono');
  });
});

describe('Inventario desde el teléfono (06-10)', () => {
  it('quien tiene Inventario tiene la pantalla; un rol «solo teléfono» entra directo a ella', () => {
    expect(vistasTelefonoDe('almacen_telefono', ['inventario']).map((v) => v.ruta)).toEqual(['inventario/telefono']);
    expect(rutaDeInicio('almacen_telefono', ['inventario'], true)).toBe('/app/inventario/telefono');
  });
  it('un rol de escritorio con Inventario sigue entrando al escritorio', () => {
    expect(rutaDeInicio('admin', ['inventario'], false)).toBe('/app/inventario');
  });
});
