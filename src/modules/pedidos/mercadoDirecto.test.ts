import { describe, expect, it } from 'vitest';
import { esPedidoDirectoACompras, esPedidoMercado, FINALIDAD_MERCADO } from './mercadoDirecto';

describe('los únicos pedidos que pasan directo a Compras son las compras fijas (19-11-2026)', () => {
  it('pasa directo a Compras únicamente cuando viene de una compra fija (compra_fija_id)', () => {
    expect(esPedidoDirectoACompras({ compra_fija_id: 'fija-mercado-001' })).toBe(true);
    expect(esPedidoDirectoACompras({ compra_fija_id: 'fija-papeleria-004' })).toBe(true);
    expect(esPedidoMercado({ compra_fija_id: 'fija-pollo-003' })).toBe(true);
  });

  it('cualquier pedido suelto sin compra_fija_id (incluyendo COCINA, ALIMENTACION o finalidad de mercado) NO pasa directo a Compras', () => {
    expect(esPedidoDirectoACompras({ compra_fija_id: null })).toBe(false);
    expect(esPedidoDirectoACompras({ compra_fija_id: '   ' })).toBe(false);
    expect(esPedidoDirectoACompras({})).toBe(false);
    expect(
      esPedidoDirectoACompras({
        compra_fija_id: null,
         ...({ finalidad: FINALIDAD_MERCADO, solicitante: 'COCINA' } as Record<string, unknown>),
      }),
    ).toBe(false);
    expect(
      esPedidoDirectoACompras({
        compra_fija_id: undefined,
        ...({ solicitante: 'ALIMENTACION' } as Record<string, unknown>),
      }),
    ).toBe(false);
  });
});
