import { describe, expect, it, vi } from 'vitest';
vi.mock('@/shared/lib/supabase', () => ({ supabase: {} }));
import { errorPagoSinCaja } from './pedidos.repository';

describe('OC pagada sin descontar de caja (06-11-2026)', () => {
  it('el motivo es obligatorio', () => {
    expect(errorPagoSinCaja('')).toMatch(/mínimo 5/);
    expect(errorPagoSinCaja('  ok ')).toMatch(/mínimo 5/);
    expect(errorPagoSinCaja('La pagó otra empresa del grupo')).toBeNull();
  });
});
