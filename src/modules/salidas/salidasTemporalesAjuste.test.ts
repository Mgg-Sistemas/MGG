import { describe, expect, it } from 'vitest';
import type { ItemSalidaTemporal } from '@/shared/lib/types';
import { ajustesDeStock } from './salidasTemporalesAjuste';

const inv = (producto_id: string, cantidad: number, almacen = 'LOS PINOS'): ItemSalidaTemporal =>
  ({ producto_id, producto_nombre: producto_id.toUpperCase(), cantidad, almacen, es_nuevo: false });

describe('ajustesDeStock', () => {
  it('sin cambios no mueve nada', () => {
    expect(ajustesDeStock([inv('a', 2)], [inv('a', 2)])).toEqual([]);
  });

  it('más cantidad sale; menos reingresa', () => {
    expect(ajustesDeStock([inv('a', 2), inv('b', 5)], [inv('a', 3), inv('b', 1)])).toEqual([
      { producto_id: 'a', almacen: 'LOS PINOS', producto_nombre: 'A', delta: 1 },
      { producto_id: 'b', almacen: 'LOS PINOS', producto_nombre: 'B', delta: -4 },
    ]);
  });

  it('quitar un material lo reingresa completo y agregar uno lo saca', () => {
    expect(ajustesDeStock([inv('a', 2)], [inv('c', 1, 'MATANZA')])).toEqual([
      { producto_id: 'a', almacen: 'LOS PINOS', producto_nombre: 'A', delta: -2 },
      { producto_id: 'c', almacen: 'MATANZA', producto_nombre: 'C', delta: 1 },
    ]);
  });

  it('suma líneas repetidas e ignora los ítems nuevos', () => {
    const nuevo: ItemSalidaTemporal = { producto_id: null, producto_nombre: 'MOTOR', cantidad: 1, es_nuevo: true };
    expect(ajustesDeStock([inv('a', 3)], [inv('a', 1), inv('a', 2), nuevo])).toEqual([]);
  });
});
