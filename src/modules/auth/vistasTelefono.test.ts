import { describe, it, expect } from 'vitest';
import { RUTA_TELEFONO, VISTAS_TELEFONO, entraPorTelefono, inicioTelefono, normalizarVistas, vistasPermitidas } from './vistasTelefono';
import type { ModuleKey } from '@/modules/usuarios/permisos.repository';

const conModulos = (...mods: ModuleKey[]) => (m: ModuleKey) => mods.includes(m);
const claves = (vs: { key: string }[]) => vs.map((v) => v.key);

describe('vistasPermitidas · pantalla dada Y lectura en su módulo (13-10)', () => {
  it('un rol con surtidor y comidas, y los dos módulos, ve las dos', () => {
    expect(claves(vistasPermitidas(['surtidor', 'comidas'], conModulos('combustible', 'cocina'), false)))
      .toEqual(['surtidor', 'comidas']);
  });

  it('sin lectura en el módulo, la pantalla no se abre aunque esté dada', () => {
    expect(claves(vistasPermitidas(['surtidor', 'comidas'], conModulos('cocina'), false))).toEqual(['comidas']);
  });

  it('con el módulo pero sin la pantalla, tampoco: la pantalla se otorga aparte', () => {
    expect(claves(vistasPermitidas(['comidas'], conModulos('combustible', 'cocina'), false))).toEqual(['comidas']);
    expect(vistasPermitidas([], conModulos('combustible', 'cocina'), false)).toEqual([]);
  });

  it('el administrador las tiene todas', () => {
    expect(vistasPermitidas([], conModulos(), true)).toEqual(VISTAS_TELEFONO);
  });

  it('De Inventario están «Inventario y Almacenes» y «Solicitudes de Pedido» (29-10), y se dan aparte como las demás', () => {
    expect(VISTAS_TELEFONO.filter((v) => v.modulo === 'inventario').map((v) => v.key)).toEqual(['inventario', 'solicitudes']);
    expect(claves(vistasPermitidas(['solicitudes'], conModulos('inventario'), false))).toEqual(['solicitudes']);
    expect(claves(vistasPermitidas(['inventario'], conModulos('inventario'), false))).toEqual(['inventario']);
    expect(VISTAS_TELEFONO.find((v) => v.key === 'inventario')?.ruta).toBe('/app/inventario/telefono');
    expect(vistasPermitidas(['surtidor', 'comidas'], conModulos('inventario'), false)).toEqual([]);
  });

  it('Delivery (30-10): pantalla del motorizado, se da por rol y pide lectura en el módulo delivery', () => {
    const d = VISTAS_TELEFONO.find((v) => v.key === 'delivery');
    expect(d).toMatchObject({ modulo: 'delivery', ruta: '/app/delivery/telefono', icono: '🛵', label: 'Delivery' });
    expect(claves(vistasPermitidas(['delivery'], conModulos('delivery'), false))).toEqual(['delivery']);
    expect(vistasPermitidas(['delivery'], conModulos('pedidos'), false)).toEqual([]);
    expect(vistasPermitidas([], conModulos('delivery'), false)).toEqual([]);
    expect(normalizarVistas(['delivery', 'delivery'])).toEqual(['delivery']);
  });
});

describe('inicioTelefono · adónde entra un rol solo teléfono', () => {
  it('con una sola pantalla, directo a ella', () => {
    const [surtidor] = VISTAS_TELEFONO;
    expect(inicioTelefono([surtidor])).toBe('/app/combustible/surtidor');
  });

  it('con varias, o con ninguna, al menú de pantallas', () => {
    expect(inicioTelefono(VISTAS_TELEFONO)).toBe(RUTA_TELEFONO);
    expect(inicioTelefono([])).toBe(RUTA_TELEFONO);
  });
});

describe('entraPorTelefono · quien tiene una pantalla dada entra por ella (13-10)', () => {
  const [surtidor] = VISTAS_TELEFONO;
  it('con el surtidor dado entra por el teléfono aunque no sea solo teléfono', () => {
    expect(entraPorTelefono({ isAdmin: false, soloTelefono: false, vistas: [surtidor] })).toBe(true);
    expect(inicioTelefono([surtidor])).toBe('/app/combustible/surtidor');
  });
  it('sin pantallas dadas entra por el escritorio; solo teléfono entra por el teléfono igual', () => {
    expect(entraPorTelefono({ isAdmin: false, soloTelefono: false, vistas: [] })).toBe(false);
    expect(entraPorTelefono({ isAdmin: false, soloTelefono: true, vistas: [] })).toBe(true);
  });
  it('el administrador entra siempre por el escritorio', () => {
    expect(entraPorTelefono({ isAdmin: true, soloTelefono: false, vistas: VISTAS_TELEFONO })).toBe(false);
  });
});

describe('normalizarVistas', () => {
  it('deja solo claves conocidas, sin repetir', () => {
    expect(normalizarVistas(['comidas', 'deposito_mina', 'comidas', 3, null])).toEqual(['comidas']);
  });

  it('lo que no es una lista queda vacío', () => {
    expect(normalizarVistas(null)).toEqual([]);
    expect(normalizarVistas('surtidor')).toEqual([]);
  });
});
