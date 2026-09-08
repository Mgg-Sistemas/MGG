import { describe, it, expect } from 'vitest';
import { esServicioOrden } from './pedidos.repository';

describe('esServicioOrden', () => {
  it('reconoce la clase servicio', () => {
    expect(esServicioOrden({ clase: 'servicio', codigo: 'SP-2026-0100' })).toBe(true);
  });

  it('reconoce las órdenes viejas por su código SV-, sin columna clase', () => {
    // Las de antes de que existiera `clase` solo se distinguen por el correlativo.
    expect(esServicioOrden({ clase: null, codigo: 'SV-2026-0013' })).toBe(true);
    expect(esServicioOrden({ clase: null, codigo: 'sv-2026-0013' })).toBe(true);
    expect(esServicioOrden({ clase: null, codigo: 'SV-2026-0009-1' })).toBe(true);
  });

  it('una compra de productos NO es un servicio', () => {
    expect(esServicioOrden({ clase: 'producto', codigo: 'SP-2026-0126' })).toBe(false);
    expect(esServicioOrden({ clase: null, codigo: 'OC-2026-0088' })).toBe(false);
  });

  it('no confunde un código que apenas contiene SV', () => {
    expect(esServicioOrden({ clase: 'producto', codigo: 'OC-SV-2026-01' })).toBe(false);
  });

  it('tolera una orden sin código ni clase', () => {
    expect(esServicioOrden({ clase: null, codigo: null })).toBe(false);
    expect(esServicioOrden({ clase: undefined, codigo: undefined })).toBe(false);
  });
});
