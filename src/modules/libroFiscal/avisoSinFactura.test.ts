import { beforeEach, describe, expect, it, vi } from 'vitest';

const cola: Array<{ data: unknown; error: unknown }> = [];
const llamadas: { tabla: string; metodos: unknown[][] }[] = [];

function consulta(tabla: string) {
  const reg = { tabla, metodos: [] as unknown[][] };
  llamadas.push(reg);
  const resp = cola.shift() ?? { data: [], error: null };
  const q: Record<string, unknown> = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(resp).then(ok, ko);
      return (...args: unknown[]) => { reg.metodos.push([prop, ...args]); return q; };
    },
  });
  return q;
}

vi.mock('@/shared/lib/supabase', () => ({
  supabase: {
    from: (t: string) => consulta(t),
  },
}));

vi.mock('./agenteCondiciones.repository', () => ({
  fechaDesdeAgenteRetencion: async () => '2026-10-01',
}));

import { origenesSinFactura } from './documentosOrigen.repository';

beforeEach(() => {
  cola.length = 0;
  llamadas.length = 0;
});

describe('origenesSinFactura · Pantalla «Sin factura» diseñada y vigilada (Etapa 1)', () => {
  it('consulta la vista origenes_sin_factura ordenada por fecha ascendente', async () => {
    cola.push({
      data: [
        { origen_tipo: 'oc', origen_id: 'oc-1', codigo: 'OC-001', desde: '2026-10-15T00:00:00Z' },
        { origen_tipo: 'compra_directa', origen_id: 'cd-1', codigo: 'CD-001', desde: '2026-10-20T00:00:00Z' },
      ],
      error: null,
    });

    const res = await origenesSinFactura();

    expect(llamadas[0].tabla).toBe('origenes_sin_factura');
    expect(llamadas[0].metodos).toContainEqual(['order', 'desde', { ascending: true, nullsFirst: false }]);
    expect(res).toHaveLength(2);
    expect(res[0].codigo).toBe('OC-001');
    expect(res[1].codigo).toBe('CD-001');
  });

  it('excluye recepciones anteriores a la fecha en que la empresa es agente de retención', async () => {
    cola.push({
      data: [
        { origen_tipo: 'oc', origen_id: 'oc-vieja', codigo: 'OC-VIEJA', desde: '2026-09-15T00:00:00Z' },
        { origen_tipo: 'oc', origen_id: 'oc-vigente', codigo: 'OC-VIGENTE', desde: '2026-10-05T00:00:00Z' },
      ],
      error: null,
    });

    const res = await origenesSinFactura();

    expect(res).toHaveLength(1);
    expect(res[0].codigo).toBe('OC-VIGENTE');
  });

  it('devuelve array vacío si no hay recepciones sin factura', async () => {
    cola.push({ data: [], error: null });
    const res = await origenesSinFactura();
    expect(res).toEqual([]);
  });

  it('lanza error legible si falla la consulta', async () => {
    cola.push({ data: null, error: { message: 'relation does not exist' } });
    await expect(origenesSinFactura()).rejects.toThrow();
  });
});

