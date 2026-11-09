import { describe, expect, it } from 'vitest';
import { esPedidoMercado, FINALIDAD_MERCADO } from './mercadoDirecto';

describe('pedidos de mercado van directo a Compras (09-11-2026)', () => {
  it('la 🛒 Solicitud de Mercado', () => {
    expect(esPedidoMercado({ finalidad: FINALIDAD_MERCADO, solicitante: 'ADMINISTRACION' })).toBe(true);
  });
  it('unidad COCINA o ALIMENTACION (con o sin acento, con sufijo)', () => {
    expect(esPedidoMercado({ solicitante: 'COCINA' })).toBe(true);
    expect(esPedidoMercado({ solicitante: ' Alimentación ' })).toBe(true);
    expect(esPedidoMercado({ solicitante: 'COCINA LOS PINOS' })).toBe(true);
  });
  it('las demás unidades pasan por Almacén', () => {
    expect(esPedidoMercado({ solicitante: 'GERENCIA GENERAL' })).toBe(false);
    expect(esPedidoMercado({ solicitante: 'COCINAS INDUSTRIALES SA' })).toBe(false);
    expect(esPedidoMercado({ solicitante: null, finalidad: null })).toBe(false);
  });
});
