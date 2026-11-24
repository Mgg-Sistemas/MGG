import { afterEach, describe, expect, it, vi } from 'vitest';

/* D2: impuestosQuePractica lee «quién practica» de UNA sola fuente (la RPC
   retencion_empresa_practica). Este test cubre el CABLEADO/detector (no fiscal):
   con el régimen por empresa en la base + empresa dada → RPC de 3 args (p_empresa);
   sin el detector, o sin empresa → la de 2 args (GT), que es la degradación segura
   mientras D2-SQL no esté aplicado. Así GT no se rompe antes del SQL. */

const rpc = vi.fn();
let hayRegimenEmpresa = false;

vi.mock('@/shared/lib/supabase', () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), from: () => ({ select: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) },
}));
// Mantiene los detectores reales salvo los dos que controla el test.
vi.mock('./disponibilidad', async (orig) => ({
  ...(await orig<typeof import('./disponibilidad')>()),
  tablaDisponible: async () => true,                 // noAplicaDisponible = true (hay R10)
  regimenPorEmpresaDisponible: async () => hayRegimenEmpresa,
}));

import { impuestosQuePractica } from './noAplica.repository';

afterEach(() => { rpc.mockReset(); });

describe('impuestosQuePractica · fuente única (RPC) con detector por empresa (D2)', () => {
  it('con detector + empresa: llama la RPC de 3 args con p_empresa por cada impuesto', async () => {
    hayRegimenEmpresa = true;
    rpc.mockResolvedValue({ data: true, error: null });
    const s = await impuestosQuePractica(['IVA', 'ISLR'], '2026-11-02', 'empresa-mto');
    expect(rpc).toHaveBeenCalledWith('retencion_empresa_practica', { p_empresa: 'empresa-mto', p_impuesto: 'IVA', p_fecha: '2026-11-02' });
    expect(rpc).toHaveBeenCalledWith('retencion_empresa_practica', { p_empresa: 'empresa-mto', p_impuesto: 'ISLR', p_fecha: '2026-11-02' });
    expect(s).toEqual(new Set(['IVA', 'ISLR']));
  });

  it('sin detector (D2 sin aplicar): cae a la RPC de 2 args (GT), sin p_empresa, aunque venga empresaId', async () => {
    hayRegimenEmpresa = false;
    rpc.mockResolvedValue({ data: true, error: null });
    await impuestosQuePractica(['IVA'], '2026-11-02', 'empresa-mto');
    expect(rpc).toHaveBeenCalledWith('retencion_empresa_practica', { p_impuesto: 'IVA', p_fecha: '2026-11-02' });
    expect(rpc).not.toHaveBeenCalledWith('retencion_empresa_practica', expect.objectContaining({ p_empresa: expect.anything() }));
  });

  it('sin empresaId: 2 args (GT) aunque el detector esté encendido', async () => {
    hayRegimenEmpresa = true;
    rpc.mockResolvedValue({ data: false, error: null });
    const s = await impuestosQuePractica(['IVA'], '2026-11-02');
    expect(rpc).toHaveBeenCalledWith('retencion_empresa_practica', { p_impuesto: 'IVA', p_fecha: '2026-11-02' });
    expect(s).toEqual(new Set());
  });
});
