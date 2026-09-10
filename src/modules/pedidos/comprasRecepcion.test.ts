import { describe, it, expect } from 'vitest';
import { faltanPorEntrar } from './comprasRecepcion';

const LAPTOP = '0d6373dd';
const MOUSE = 'd946d198';

describe('qué falta por entrar al recibir una compra directa', () => {
  it('sin nada registrado, entran todos los renglones', () => {
    const items = [{ producto_id: LAPTOP }, { producto_id: MOUSE }];
    expect(faltanPorEntrar(items, [])).toEqual(items);
  });

  it('el caso CD-2026-0065: si ya entraron los dos, un reintento no repite nada', () => {
    const items = [{ producto_id: LAPTOP }, { producto_id: MOUSE }];
    const ya = [{ producto_id: LAPTOP }, { producto_id: MOUSE }];
    expect(faltanPorEntrar(items, ya)).toEqual([]);
  });

  it('si se cortó a mitad de camino, solo falta lo que no alcanzó a entrar', () => {
    const items = [{ producto_id: LAPTOP }, { producto_id: MOUSE }];
    expect(faltanPorEntrar(items, [{ producto_id: LAPTOP }])).toEqual([{ producto_id: MOUSE }]);
  });

  it('dos renglones del mismo material: una entrada tacha uno solo', () => {
    const items = [{ producto_id: LAPTOP, cantidad: 1 }, { producto_id: LAPTOP, cantidad: 4 }];
    expect(faltanPorEntrar(items, [{ producto_id: LAPTOP }])).toEqual([{ producto_id: LAPTOP, cantidad: 4 }]);
  });

  it('una entrada de otra compra no tacha nada de esta', () => {
    const items = [{ producto_id: LAPTOP }];
    expect(faltanPorEntrar(items, [{ producto_id: 'otro-producto' }])).toEqual(items);
  });

  it('un renglón sin material no se pierde: sigue pendiente y el repositorio lo saltea', () => {
    const items = [{ producto_id: null }, { producto_id: MOUSE }];
    expect(faltanPorEntrar(items, [{ producto_id: null }])).toEqual(items);
  });
});
