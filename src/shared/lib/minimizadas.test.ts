import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_MINIMIZADAS, cancelarSalida, confirmarSalida, descartarDesdeBarra, intentarSalir, intercambiarMinimizada,
  leerMinimizadas, leerVentanasVisibles, minimizar, mismoModulo, moduloActual, quitarMinimizada, registrarModulo,
  restaurarDesdeBarra, restauraConVentanaAbierta, vaciarMinimizadas, ventanaVisible,
} from './minimizadas';

const MOD = 'Pedidos / Compras';
const RUTA = '/app/pedidos';
const a = { id: 'a', titulo: 'Orden SP-1' };
const b = { id: 'b', titulo: 'Orden SP-2' };
const c = { id: 'c', titulo: 'Orden SP-3' };
const d = { id: 'd', titulo: 'Orden SP-4' };

afterEach(() => vaciarMinimizadas());

describe('mismoModulo', () => {
  it('la ruta base y lo que cuelga de ella es el mismo módulo', () => {
    expect(mismoModulo(RUTA, '/app/pedidos')).toBe(true);
    expect(mismoModulo(RUTA, '/app/pedidos?detalle=1')).toBe(true);
    expect(mismoModulo(RUTA, '#/app/pedidos/x')).toBe(true);
    expect(mismoModulo(RUTA, '/app/pedidos/')).toBe(true);
  });
  it('otro módulo (incluso con prefijo parecido) no lo es', () => {
    expect(mismoModulo(RUTA, '/app/proveedores')).toBe(false);
    expect(mismoModulo(RUTA, '/app/pedidos-viejos')).toBe(false);
    expect(mismoModulo(RUTA, '/app')).toBe(false);
    expect(mismoModulo('', '/app/pedidos')).toBe(false);
  });
});

describe('minimizar', () => {
  it('admite hasta MAX_MINIMIZADAS y avisa «lleno» a la siguiente', () => {
    expect(MAX_MINIMIZADAS).toBe(3);
    expect(minimizar(MOD, RUTA, a)).toBe('ok');
    expect(minimizar(MOD, RUTA, b)).toBe('ok');
    expect(minimizar(MOD, RUTA, c)).toBe('ok');
    expect(minimizar(MOD, RUTA, d)).toBe('lleno');
    expect(leerMinimizadas().items.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });
  it('minimizar la misma dos veces no la duplica ni gasta lugar (y refresca el título)', () => {
    minimizar(MOD, RUTA, a);
    minimizar(MOD, RUTA, b);
    minimizar(MOD, RUTA, c);
    expect(minimizar(MOD, RUTA, { id: 'a', titulo: 'Orden SP-1 · URGENTE' })).toBe('ok');
    expect(leerMinimizadas().items).toHaveLength(3);
    expect(leerMinimizadas().items[0].titulo).toBe('Orden SP-1 · URGENTE');
  });
  it('guarda el módulo y su ruta para el aviso de salida', () => {
    minimizar(MOD, RUTA, a);
    expect(leerMinimizadas().modulo).toBe(MOD);
    expect(leerMinimizadas().ruta).toBe(RUTA);
  });
  it('lo de otro módulo no se mezcla: arranca la barra de nuevo', () => {
    minimizar(MOD, RUTA, a);
    minimizar('Proveedores', '/app/proveedores', b);
    expect(leerMinimizadas().items.map((x) => x.id)).toEqual(['b']);
  });
});

describe('quitar / intercambiar / vaciar', () => {
  it('quitar la última deja el estado vacío (sin módulo)', () => {
    minimizar(MOD, RUTA, a);
    quitarMinimizada('a');
    expect(leerMinimizadas().items).toHaveLength(0);
    expect(leerMinimizadas().ruta).toBe('');
  });
  it('quitar una que no existe no hace nada', () => {
    minimizar(MOD, RUTA, a);
    quitarMinimizada('zzz');
    expect(leerMinimizadas().items).toHaveLength(1);
  });
  it('restaurar con otra abierta: la abierta ocupa el lugar y no se pasa del máximo', () => {
    minimizar(MOD, RUTA, a);
    minimizar(MOD, RUTA, b);
    minimizar(MOD, RUTA, c);
    intercambiarMinimizada('b', d);
    expect(leerMinimizadas().items.map((x) => x.id)).toEqual(['a', 'd', 'c']);
  });
  it('intercambiar con una que ya estaba minimizada no la duplica', () => {
    minimizar(MOD, RUTA, a);
    minimizar(MOD, RUTA, b);
    intercambiarMinimizada('a', b);
    expect(leerMinimizadas().items.map((x) => x.id)).toEqual(['b']);
  });
  it('vaciar limpia todo', () => {
    minimizar(MOD, RUTA, a);
    vaciarMinimizadas();
    expect(leerMinimizadas().items).toHaveLength(0);
  });
});

describe('salir del módulo', () => {
  it('sin pestañas minimizadas se sale sin preguntar', () => {
    expect(intentarSalir('/app/proveedores')).toBe(true);
    expect(leerMinimizadas().salida).toBeNull();
  });
  it('dentro del mismo módulo se navega sin preguntar', () => {
    minimizar(MOD, RUTA, a);
    expect(intentarSalir('/app/pedidos?detalle=9')).toBe(true);
    expect(leerMinimizadas().salida).toBeNull();
  });
  it('a otro módulo con pestañas minimizadas: no deja pasar y queda pendiente', () => {
    minimizar(MOD, RUTA, a);
    expect(intentarSalir('/app/proveedores')).toBe(false);
    expect(leerMinimizadas().salida).toBe('/app/proveedores');
    expect(leerMinimizadas().items).toHaveLength(1);
  });
  it('cancelar se queda en el módulo con sus pestañas', () => {
    minimizar(MOD, RUTA, a);
    intentarSalir('/app/proveedores');
    cancelarSalida();
    expect(leerMinimizadas().salida).toBeNull();
    expect(leerMinimizadas().items).toHaveLength(1);
  });
  it('confirmar devuelve el destino y pierde las pestañas', () => {
    minimizar(MOD, RUTA, a);
    minimizar(MOD, RUTA, b);
    intentarSalir('/app/inventario');
    expect(confirmarSalida()).toBe('/app/inventario');
    expect(leerMinimizadas().items).toHaveLength(0);
    expect(leerMinimizadas().salida).toBeNull();
  });
});

describe('ventanas vivas (cualquier Modal de cualquier módulo)', () => {
  it('restaurar desde la barra llama al restaurador de esa pestaña', () => {
    const restaurar = vi.fn();
    minimizar('Tesorería', '/app/tesoreria', { id: ':r1:', titulo: 'Nueva salida' }, { restaurar });
    expect(restaurarDesdeBarra(':r1:')).toBe(true);
    expect(restaurar).toHaveBeenCalledTimes(1);
  });
  it('una pestaña sin restaurador la maneja la página (devuelve false)', () => {
    minimizar(MOD, RUTA, a);
    expect(restaurarDesdeBarra('a')).toBe(false);
  });
  it('la ✕ de la pestaña cierra la ventana viva; sin descartar solo la saca de la barra', () => {
    const descartar = vi.fn();
    minimizar('Ventas', '/app/ventas', { id: 'v', titulo: 'Factura' }, { restaurar: vi.fn(), descartar });
    descartarDesdeBarra('v');
    expect(descartar).toHaveBeenCalledTimes(1);
    minimizar('Ventas', '/app/ventas', { id: 'w', titulo: 'Nota' });
    descartarDesdeBarra('w');
    expect(leerMinimizadas().items.map((x) => x.id)).toEqual(['v']);
  });
  it('quitar, vaciar o salir del módulo olvidan el restaurador', () => {
    const restaurar = vi.fn();
    minimizar(MOD, RUTA, a, { restaurar });
    quitarMinimizada('a');
    expect(restaurarDesdeBarra('a')).toBe(false);
    minimizar(MOD, RUTA, b, { restaurar });
    vaciarMinimizadas();
    expect(restaurarDesdeBarra('b')).toBe(false);
    minimizar(MOD, RUTA, c, { restaurar });
    intentarSalir('/app/ventas');
    confirmarSalida();
    expect(restaurarDesdeBarra('c')).toBe(false);
  });
  it('cambiar de módulo olvida los restauradores del anterior', () => {
    minimizar(MOD, RUTA, a, { restaurar: vi.fn() });
    minimizar('Ventas', '/app/ventas', b, { restaurar: vi.fn() });
    expect(restaurarDesdeBarra('a')).toBe(false);
    expect(restaurarDesdeBarra('b')).toBe(true);
  });
  it('intercambiar pasa el restaurador a la ventana que ocupa el lugar', () => {
    minimizar(MOD, RUTA, a, { restaurar: vi.fn(), conVentanaAbierta: true });
    const nuevo = vi.fn();
    intercambiarMinimizada('a', b, { restaurar: nuevo, conVentanaAbierta: true });
    expect(restaurarDesdeBarra('a')).toBe(false);
    expect(restaurarDesdeBarra('b')).toBe(true);
    expect(nuevo).toHaveBeenCalledTimes(1);
  });
  it('solo las que lo piden se restauran con otra ventana abierta', () => {
    minimizar(MOD, RUTA, a, { restaurar: vi.fn(), conVentanaAbierta: true });
    minimizar(MOD, RUTA, b, { restaurar: vi.fn() });
    expect(restauraConVentanaAbierta('a')).toBe(true);
    expect(restauraConVentanaAbierta('b')).toBe(false);
    expect(restauraConVentanaAbierta('zzz')).toBe(false);
  });
  it('cuenta las ventanas a la vista sin bajar de cero', () => {
    const base = leerVentanasVisibles();
    ventanaVisible(1);
    ventanaVisible(1);
    expect(leerVentanasVisibles()).toBe(base + 2);
    ventanaVisible(-1);
    ventanaVisible(-1);
    expect(leerVentanasVisibles()).toBe(base);
    ventanaVisible(-1);
    expect(leerVentanasVisibles()).toBe(Math.max(0, base - 1));
    while (leerVentanasVisibles() > 0) ventanaVisible(-1);
  });
});

describe('moduloActual', () => {
  it('fuera de la app (login, públicas) no hay módulo donde minimizar', () => {
    expect(moduloActual('#/login')).toBeNull();
    expect(moduloActual('')).toBeNull();
    expect(moduloActual('#/app')).toBeNull();
  });
  it('usa el nombre y la ruta que declara el menú (la más específica gana)', () => {
    registrarModulo('/app/acopio', 'La Esperanza');
    registrarModulo('/app/acopio/peramanal-ender', 'Peramanal (Ender Mejías)');
    expect(moduloActual('#/app/acopio')).toEqual({ nombre: 'La Esperanza', ruta: '/app/acopio' });
    expect(moduloActual('#/app/acopio/peramanal-ender?x=1')).toEqual({ nombre: 'Peramanal (Ender Mejías)', ruta: '/app/acopio/peramanal-ender' });
  });
  it('una subruta cae en el módulo de su menú', () => {
    registrarModulo('/app/maquinaria', 'Control de Maquinaria y Vehículos');
    expect(moduloActual('#/app/maquinaria/ordenes/5')?.ruta).toBe('/app/maquinaria');
  });
  it('sin menú registrado se arma con el primer tramo de la ruta', () => {
    expect(moduloActual('#/app/zzprueba/detalle')).toEqual({ nombre: 'Zzprueba', ruta: '/app/zzprueba' });
  });
});
