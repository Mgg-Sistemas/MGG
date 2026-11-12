import { describe, expect, it } from 'vitest';
import { esGeneralPendiente, skuOGuion, skuVisible } from './renglonVisible';

describe('el código que se ve de un renglón', () => {
  it('un SKU real se ve igual', () => {
    expect(skuVisible({ sku: 'MAN-002', productoId: 'p' })).toBe('MAN-002');
  });
  it('el GEN-… ligado muestra el del producto; sin ligar, «—»', () => {
    expect(skuVisible({ sku: 'GEN-MWC83RKC-4', productoId: 'p', sku_inventario: 'MAN-002' })).toBe('MAN-002');
    expect(skuVisible({ sku: 'GEN-MWC83RKC-4', productoId: 'p' }, () => 'MAN-003')).toBe('MAN-003');
    expect(skuOGuion({ sku: 'GEN-MWC83RKC-4', productoId: undefined })).toBe('—');
    expect(skuOGuion({ sku: 'gen-abc', productoId: 'p' })).toBe('—');
  });
  it('la etiqueta «nombre general» solo mientras no tiene producto', () => {
    expect(esGeneralPendiente({ general: true, productoId: undefined })).toBe(true);
    expect(esGeneralPendiente({ general: true, productoId: 'p' })).toBe(false);
  });
});
