import { describe, expect, it } from 'vitest';
import {
  errorMarcasRecepcion, marcaCambio, marcaQueEntra, marcasRecibidas, normMarca,
  textoMarcaKardex, textoMarcaRecepcion,
} from './marcaRecibida';

describe('marca recibida', () => {
  it('normaliza espacios y mayúsculas', () => {
    expect(normMarca('  shell   helix ')).toBe('SHELL HELIX');
    expect(normMarca(null)).toBe('');
  });

  it('solo es cambio cuando se pidió una marca y llegó otra', () => {
    expect(marcaCambio('Shell', 'Castrol')).toBe(true);
    expect(marcaCambio('Shell', 'shell ')).toBe(false);
    expect(marcaCambio('Shell', '')).toBe(false);
    expect(marcaCambio('', 'Castrol')).toBe(false);
    expect(marcaCambio(null, null)).toBe(false);
  });

  it('entra la recibida; si no se indicó, la pedida', () => {
    expect(marcaQueEntra('Shell', 'Castrol')).toBe('CASTROL');
    expect(marcaQueEntra('Shell', '')).toBe('SHELL');
    expect(marcaQueEntra(null, undefined)).toBeNull();
  });

  it('exige nota cuando la marca cambió', () => {
    const items = [{ sku: 'A', nombre: 'ACEITE 15W40', marca: 'Shell' }, { sku: 'B', marca: null }];
    expect(errorMarcasRecepcion(items, [{ sku: 'A', marca_recibida: 'Shell' }, { sku: 'B', marca_recibida: 'Castrol' }])).toBeNull();
    expect(errorMarcasRecepcion(items, [{ sku: 'A', marca_recibida: 'Castrol', nota_marca: '' }])).toMatch(/ACEITE 15W40.*CASTROL.*SHELL/);
    expect(errorMarcasRecepcion(items, [{ sku: 'A', marca_recibida: 'Castrol', nota_marca: 'No tenía Shell' }])).toBeNull();
  });

  it('arma los textos de OC y kardex', () => {
    expect(textoMarcaRecepcion({ marca: 'Shell', marca_recibida: 'Castrol' })).toBe('Pedido: SHELL · Recibido: CASTROL');
    expect(textoMarcaRecepcion({ marca: 'Shell', marca_recibida: 'Shell' })).toBeNull();
    expect(textoMarcaKardex('Shell', 'Castrol')).toBe(' · marca CASTROL (pedida: SHELL)');
    expect(textoMarcaKardex('Shell', null)).toBe(' · marca SHELL');
    expect(textoMarcaKardex(null, null)).toBe('');
  });

  it('resume lo que entró por marca, de mayor a menor', () => {
    const r = marcasRecibidas([
      { tipo: 'entrada', delta: 4, marca: 'Shell' },
      { tipo: 'entrada', delta: 12, marca: 'castrol' },
      { tipo: 'entrada', delta: 2, marca: 'Shell' },
      { tipo: 'salida', delta: -3, marca: 'Shell' },
      { tipo: 'entrada', delta: 9, marca: null },
    ]);
    expect(r).toEqual([
      { marca: 'CASTROL', cantidad: 12, veces: 1 },
      { marca: 'SHELL', cantidad: 6, veces: 2 },
    ]);
  });
});
