import { describe, expect, it } from 'vitest';
import { faltaEnLaCarga } from './validarCarga';

describe('lo que la carga exige antes de registrar', () => {
  it('sin N° de factura no se registra una retención de IVA, ISLR o municipal', () => {
    for (const tipo of ['iva', 'islr', 'municipal', 'regional'] as const) {
      expect(faltaEnLaCarga({ tipo, facturaNumero: '' })).toContain('N° de la factura');
      expect(faltaEnLaCarga({ tipo, facturaNumero: '   ' })).toContain('N° de la factura');
    }
  });

  it('con el N° de factura, no falta nada', () => {
    expect(faltaEnLaCarga({ tipo: 'iva', facturaNumero: '000123' })).toBeNull();
  });

  it('el IGTF no pide factura: es una percepción por pago', () => {
    expect(faltaEnLaCarga({ tipo: 'igtf', facturaNumero: '' })).toBeNull();
  });
});
