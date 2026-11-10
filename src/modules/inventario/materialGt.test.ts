import { describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/lib/supabase', () => ({ supabase: {} }));
vi.mock('./movimientos.repository', () => ({ registrarMovimiento: vi.fn() }));
vi.mock('./inventario.repository', () => ({ createProducto: vi.fn(), siguienteSkuGlobal: vi.fn() }));

import { normNombre, sugerirProducto } from './materialGt.repository';

describe('Mercancía de GT · emparejar por nombre (10/11/2026)', () => {
  it('normaliza tildes, signos y espacios', () => {
    expect(normNombre('  Máscarilla 3M-8210 ')).toBe('MASCARILLA 3M 8210');
  });
  it('sugiere el producto activo con el mismo nombre, sin mirar el código', () => {
    const productos = [
      { id: 'a', nombre: 'MASCARILLA 3M 8210', sku: 'EPP-022', estado: 'activo' as const },
      { id: 'b', nombre: 'GUANTES DE PUNTO', sku: 'EPP-012', estado: 'inactivo' as const },
    ];
    expect(sugerirProducto({ nombre: 'Mascarilla 3M 8210' }, productos)).toBe('a');
    expect(sugerirProducto({ nombre: 'GUANTES DE PUNTO' }, productos)).toBeNull();
    expect(sugerirProducto({ nombre: 'TORNILLO' }, productos)).toBeNull();
  });
});
