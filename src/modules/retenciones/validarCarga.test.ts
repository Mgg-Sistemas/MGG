import { describe, expect, it } from 'vitest';
import { faltaEnLaCarga } from './validarCarga';

describe('lo que la carga exige antes de registrar', () => {
  it('sin N° de factura no se registra una retención de IVA, ISLR o municipal', () => {
    for (const tipo of ['iva', 'islr', 'municipal', 'regional'] as const) {
      expect(faltaEnLaCarga({ tipo, facturaNumero: '', facturaFecha: '2026-10-01' })).toContain('N° de factura requerido');
      expect(faltaEnLaCarga({ tipo, facturaNumero: '   ', facturaFecha: '2026-10-01' })).toContain('N° de factura requerido');
    }
  });

  it('con el N° de factura, no falta nada', () => {
    expect(faltaEnLaCarga({ tipo: 'iva', facturaNumero: '000123', facturaFecha: '2026-10-01' })).toBeNull();
  });

  it('el IGTF no pide factura: es una percepción por pago', () => {
    expect(faltaEnLaCarga({ tipo: 'igtf', facturaNumero: '', facturaFecha: '2026-10-01' })).toBeNull();
  });

  it('sin fecha de la factura no se registra: de ella sale el período (y en IVA la quincena)', () => {
    for (const tipo of ['iva', 'islr', 'municipal', 'regional', 'igtf'] as const) {
      expect(faltaEnLaCarga({ tipo, facturaNumero: '000123', facturaFecha: '' })).toContain('Fecha de la factura requerida');
    }
  });

  it('una fecha a medias tampoco sirve', () => {
    expect(faltaEnLaCarga({ tipo: 'islr', facturaNumero: '000123', facturaFecha: '2026-10' })).toContain('Fecha de la factura requerida');
    expect(faltaEnLaCarga({ tipo: 'islr', facturaNumero: '000123', facturaFecha: '2026-13-01' })).toContain('Fecha de la factura requerida');
  });
});
