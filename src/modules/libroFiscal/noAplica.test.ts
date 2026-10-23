import { beforeEach, describe, expect, it, vi } from 'vitest';

// Cola de respuestas de la base y registro de lo que se pidió (datos inventados).
const cola: { data?: unknown; error?: unknown }[] = [];
const llamadas: { que: string; args: unknown[] }[] = [];

vi.mock('./disponibilidad', () => ({ tablaDisponible: async () => true }));
vi.mock('@/shared/lib/supabase', () => {
  const cadena = (que: string) => {
    const q: Record<string, unknown> = new Proxy({}, {
      get(_t, prop) {
        if (prop === 'then') {
          const r = cola.shift() ?? { data: null, error: null };
          return (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null, ...r }).then(ok);
        }
        return (...args: unknown[]) => { llamadas.push({ que: `${que}.${String(prop)}`, args }); return q; };
      },
    });
    return q;
  };
  return {
    supabase: {
      from: (t: string) => { llamadas.push({ que: 'from', args: [t] }); return cadena(t); },
      rpc: (f: string, p: unknown) => { llamadas.push({ que: 'rpc', args: [f, p] }); return cadena(`rpc:${f}`); },
    },
  };
});

import { marcarNoAplica, noAplicaPorOrden } from './noAplica.repository';

const BASE = {
  ordenId: 'orden-1', proveedorId: 'prov-1', proveedorNombre: 'Proveedor de prueba', moneda: 'Bs', total: 100,
  impuestoClave: 'IVA', motivoId: null, motivoTexto: 'No es documento fiscal', detalle: null, actor: 'prueba@ejemplo.com',
};

beforeEach(() => { cola.length = 0; llamadas.length = 0; });

describe('marcar «no aplica»', () => {
  it('sin documento: registra solo el documento (sin líneas) y luego la decisión', async () => {
    cola.push({ data: [] });                                   // la orden no tiene documento
    cola.push({ data: { factura: { id: 'doc-nuevo' }, lineas: [] } }); // factura sola
    cola.push({ data: null, error: null });                    // insert de la decisión
    expect(await marcarNoAplica(BASE)).toBe('doc-nuevo');
    const rpc = llamadas.find((l) => l.que === 'rpc');
    expect(rpc?.args[0]).toBe('retencion_factura_registrar');
    const p = rpc?.args[1] as { p_factura: Record<string, unknown>; p_lineas: unknown[] };
    expect(p.p_lineas).toEqual([]);
    expect(p.p_factura.solo_documento).toBe(true);
    expect(p.p_factura.factura_nro).toBeNull();               // no pide N° de factura
    const ins = llamadas.find((l) => l.que === 'retencion_decisiones.insert');
    expect(ins?.args[0]).toMatchObject({ documento_id: 'doc-nuevo', impuesto_clave: 'IVA', decision: 'no_aplica', motivo_texto: 'No es documento fiscal' });
  });

  it('con documento: no registra otro, solo la decisión', async () => {
    cola.push({ data: [{ documento_id: 'doc-1' }] });
    cola.push({ data: null, error: null });
    expect(await marcarNoAplica(BASE)).toBe('doc-1');
    expect(llamadas.some((l) => l.que === 'rpc')).toBe(false);
  });

  it('sin motivo no guarda nada', async () => {
    await expect(marcarNoAplica({ ...BASE, motivoTexto: '  ' })).rejects.toThrow(/motivo/);
    expect(llamadas.length).toBe(0);
  });

  it('una decisión repetida dice que ya existe', async () => {
    cola.push({ data: [{ documento_id: 'doc-1' }] });
    cola.push({ error: { code: '23505', message: 'duplicate key' } });
    await expect(marcarNoAplica(BASE)).rejects.toThrow(/ya tiene una decisión/);
  });
});

describe('lo marcado «no aplica» por orden', () => {
  it('suma solo las decisiones no_aplica, con la clave traducida', async () => {
    cola.push({ data: [{ origen_id: 'orden-1', decisiones: { IVA: 'no_aplica', ISLR: 'aplica' } }, { origen_id: 'orden-2', decisiones: { MUNICIPAL: 'no_aplica' } }] });
    const m = await noAplicaPorOrden(['orden-1', 'orden-2']);
    expect([...(m.get('orden-1') ?? [])]).toEqual(['iva']);
    expect([...(m.get('orden-2') ?? [])]).toEqual(['municipal']);
  });
});
