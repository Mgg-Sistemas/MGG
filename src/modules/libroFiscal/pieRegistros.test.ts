import { describe, expect, it } from 'vitest';
import { pieRegistros } from './pieRegistros';

const fila = (over: Partial<{ anulada: boolean; direccion: string; comprobantePath: string | null }> = {}) =>
  ({ anulada: false, direccion: 'practicada', comprobantePath: null, ...over });

describe('el pie de la tarjeta «Registros» del libro fiscal', () => {
  it('con todo en regla dice «Todos con comprobante»', () => {
    expect(pieRegistros([fila(), fila({ direccion: 'recibida', comprobantePath: 'retenciones/r-2/comprobante.pdf' })])).toBe('Todos con comprobante');
  });

  it('una recibida sin el PDF del cliente no cuenta como «con comprobante»', () => {
    expect(pieRegistros([fila(), fila({ direccion: 'recibida' })])).toBe('1 sin el PDF del cliente');
  });

  it('cuenta las recibidas sin PDF, en plural', () => {
    expect(pieRegistros([fila({ direccion: 'recibida' }), fila({ direccion: 'recibida' }), fila()])).toBe('2 sin el PDF del cliente');
  });

  it('una practicada sin adjunto no se marca: su comprobante lo emite la empresa', () => {
    expect(pieRegistros([fila(), fila()])).toBe('Todos con comprobante');
  });

  it('las anuladas se informan aparte y no cuentan como faltantes', () => {
    expect(pieRegistros([fila(), fila({ anulada: true, direccion: 'recibida' })])).toBe('1 anulada aparte');
    expect(pieRegistros([fila({ anulada: true }), fila({ anulada: true })])).toBe('2 anuladas aparte');
  });

  it('con faltantes y anuladas, se informan las dos cosas', () => {
    expect(pieRegistros([fila({ direccion: 'recibida' }), fila({ anulada: true })])).toBe('1 sin el PDF del cliente · 1 anulada aparte');
  });

  it('sin registros no afirma que todos tengan comprobante', () => {
    expect(pieRegistros([])).toBe('Sin registros en el período');
  });
});
