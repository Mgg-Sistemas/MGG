import { describe, expect, it } from 'vitest';
import { textoWhatsappTesoreria } from './whatsappTesoreria';
import { textoTesoreriaAlDia } from './resumenPorPagarWhatsapp';

describe('Tesorería al día (07-11-2026)', () => {
  const opts = { ambito: 'por_pagar' as const, desde: '2026-11-01', hasta: '2026-11-07' };

  it('el reporte dinámico sin nada por pagar dice «0» y «al día»', () => {
    const t = textoWhatsappTesoreria([], { ...opts, alDia: true });
    expect(t).toContain('*ÓRDENES PENDIENTES POR PAGAR: 0*');
    expect(t).toContain('✅ *TESORERÍA AL DÍA EN PAGOS PENDIENTES*');
  });

  it('si quedó vacío solo por los filtros, NO dice «al día»', () => {
    const t = textoWhatsappTesoreria([], opts);
    expect(t).not.toContain('AL DÍA');
  });

  it('cuentas a crédito sin saldo dice «0» y «al día en cuentas a crédito»', () => {
    const t = textoWhatsappTesoreria([], { ...opts, ambito: 'creditos_cartera', alDia: true });
    expect(t).toContain('*CUENTAS A CRÉDITO (OC Y OS) PENDIENTES: 0*');
    expect(t).toContain('✅ *TESORERÍA AL DÍA EN CUENTAS A CRÉDITO*');
    expect(t).not.toContain('ÓRDENES PENDIENTES POR PAGAR: 0');
  });

  it('el resumen por lote sin órdenes trae la fecha y «al día», sin U+FE0F', () => {
    const t = textoTesoreriaAlDia(new Date('2026-11-07T14:00:00Z'));
    expect(t).toContain('ÓRDENES PENDIENTES POR PAGAR: 0');
    expect(t).toContain('TESORERÍA AL DÍA EN PAGOS PENDIENTES');
    expect(t).toContain('07/11/2026');
    expect(/️/.test(t)).toBe(false);
  });
});
