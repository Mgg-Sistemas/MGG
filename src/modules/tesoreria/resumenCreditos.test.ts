import { describe, expect, it } from 'vitest';
import { textoCreditosAlDia, textoResumenPorPagar } from './resumenPorPagarWhatsapp';

describe('Resumen WhatsApp de cuentas a crédito (09-11-2026)', () => {
  const ahora = new Date('2026-11-09T14:00:00Z');
  it('lleva el saldo de cada crédito y cuáles se pagan', () => {
    const t = textoResumenPorPagar([
      { codigo: 'CS-2026-0012', proveedor: 'CORNELIO FARIAS', montoUsd: 3000, motivo: 'si' },
      { codigo: 'OC-2026-0140', proveedor: 'EL TORETE', montoUsd: 991.25, motivo: 'sin_fondos' },
    ], ahora, { creditos: true });
    expect(t).toContain('CUENTAS A CRÉDITO POR PAGAR');
    expect(t).toContain('*Saldo:* $3.000,00');
    expect(t).toContain('Total (2 cuentas)');
    expect(t).toContain('Se pagarán (1)');
    expect(/️/.test(t)).toBe(false);
  });
  it('sin créditos pendientes', () => {
    const t = textoCreditosAlDia(ahora);
    expect(t).toContain('CUENTAS A CRÉDITO PENDIENTES: 0');
    expect(t).toContain('09/11/2026');
  });
});
