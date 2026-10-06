import { describe, expect, it } from 'vitest';
import { codigoNotaEnvio, errorNotaEnvio, filtrarDestinatarios, normalizarNotaEnvio, totalNotaEnvio } from './notaEnvio';

const base = {
  fecha: '2026-10-06', razon_social: ' golden touch 1127, c.a. ', rif: 'j-501299935', atencion_a: 'Susej',
  condicion: 'Facturas originales', entregado_por: 'Dorianne Pérez',
  items: [
    { descripcion: 'Facturas originales Golden Touch', cantidad: 296 },
    { descripcion: 'Facturas originales Golden Lion', cantidad: 30 },
    { descripcion: 'Facturas originales de la cantera', cantidad: 45 },
    { descripcion: '', cantidad: 0 },
  ],
};

describe('nota de envío', () => {
  it('arma el correlativo con cuatro dígitos', () => {
    expect(codigoNotaEnvio(1)).toBe('NE-0001');
    expect(codigoNotaEnvio(12345)).toBe('NE-12345');
  });

  it('totaliza solo los renglones válidos', () => {
    expect(totalNotaEnvio(base.items)).toBe(371);
  });

  it('valida lo mínimo para emitir', () => {
    expect(errorNotaEnvio(base)).toBeNull();
    expect(errorNotaEnvio({ ...base, razon_social: ' ' })).toMatch(/a quién/);
    expect(errorNotaEnvio({ ...base, items: [] })).toMatch(/renglón/);
    expect(errorNotaEnvio({ ...base, items: [{ descripcion: 'Actas', cantidad: 0 }] })).toMatch(/Actas.*cantidad/);
    expect(errorNotaEnvio({ ...base, entregado_por: '' })).toMatch(/quién entrega/);
    expect(errorNotaEnvio({ ...base, fecha: '06/10/2026' })).toMatch(/fecha/);
  });

  it('normaliza textos y descarta renglones vacíos', () => {
    const n = normalizarNotaEnvio(base);
    expect(n.razon_social).toBe('GOLDEN TOUCH 1127, C.A.');
    expect(n.rif).toBe('J-501299935');
    expect(n.items).toHaveLength(3);
    expect(n.items[0].descripcion).toBe('FACTURAS ORIGINALES GOLDEN TOUCH');
    expect(n.total_cantidad).toBe(371);
    expect(n.entregado_por).toBe('DORIANNE PÉREZ');
    expect(n.direccion).toBeNull();
  });

  it('busca destinatarios por cualquier dato', () => {
    const lista = [
      { razon_social: 'GOLDEN TOUCH 1127, C.A.', rif: 'J-501299935', atencion_a: 'SUSEJ' },
      { razon_social: 'SENIAT', rif: null, atencion_a: null },
    ];
    expect(filtrarDestinatarios(lista, 'susej').map((d) => d.razon_social)).toEqual(['GOLDEN TOUCH 1127, C.A.']);
    expect(filtrarDestinatarios(lista, 'golden 1127')).toHaveLength(1);
    expect(filtrarDestinatarios(lista, '')).toHaveLength(2);
  });
});
