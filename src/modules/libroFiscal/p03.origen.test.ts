import { beforeEach, describe, expect, it, vi } from 'vitest';

const cola: Array<{ data: unknown; error: unknown }> = [];
const llamadas: { tabla: string; metodos: unknown[][] }[] = [];
let conP03 = true;

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

vi.mock('@/shared/lib/supabase', () => ({ supabase: { from: (t: string) => consulta(t), rpc: vi.fn() } }));
vi.mock('@/modules/libroFiscal/disponibilidad', () => ({ p03Disponible: async () => conP03, tablaDisponible: async () => conP03 }));

import { aFacturaDeOrigen, cubrirOrigen, dejarDeCubrir, facturasPorRegistrar, porOrigen } from './documentosOrigen.repository';
import { TEXTO_ORIGEN_CON_DOCUMENTO, errorBorrarOrigen, exigirSinFacturaRegistrada } from '@/modules/pedidos/origenRegistrado';

// Datos inventados.
const filaVista = (over: Record<string, unknown> = {}) => ({
  adjunto_id: 'adj-1', modulo: 'orden_factura', origen_tipo: 'oc', origen_id: 'oc-1', bucket: 'compras-oc',
  path: 'oc-1/facturas/k1-f.pdf', nombre: 'f.pdf', content_type: 'application/pdf', es_factura: true,
  subido_por: 'compras@ejemplo.com', subido_en: '2026-10-20T10:00:00Z', registrado: false, documentos: null, ...over,
});

beforeEach(() => { cola.length = 0; llamadas.length = 0; conP03 = true; });

describe('facturas de Compras por registrar (P03)', () => {
  it('lee la vista, solo las no registradas y, si se pide, de esos orígenes', async () => {
    cola.push({ data: [filaVista(), filaVista({ adjunto_id: 'adj-2', origen_tipo: 'compra_directa', origen_id: 'cd-1', modulo: 'compra' })], error: null });
    const fs = await facturasPorRegistrar(['oc-1', 'cd-1']);
    expect(llamadas[0].tabla).toBe('origen_facturas_adjuntos_estado');
    expect(llamadas[0].metodos).toContainEqual(['eq', 'registrado', false]);
    expect(llamadas[0].metodos).toContainEqual(['in', 'origen_id', ['oc-1', 'cd-1']]);
    expect(fs.map((f) => f.origen.tipo)).toEqual(['oc', 'compra_directa']);
    expect(porOrigen(fs).get('cd-1')?.[0].adjuntoId).toBe('adj-2');
  });

  it('con una lista vacía de orígenes no consulta', async () => {
    expect(await facturasPorRegistrar([])).toEqual([]);
    expect(llamadas).toHaveLength(0);
  });

  it('mapea la fila de la vista', () => {
    const f = aFacturaDeOrigen(filaVista({ registrado: true, documentos: ['d-1'] }));
    expect(f).toMatchObject({ adjuntoId: 'adj-1', modulo: 'orden_factura', bucket: 'compras-oc', registrado: true, documentos: ['d-1'] });
  });
});

describe('una factura que cubre varias órdenes (P03)', () => {
  it('agrega el enlace en la puente con la columna del origen', async () => {
    cola.push({ data: [{ id: 'e-2' }], error: null });
    expect(await cubrirOrigen('d-1', { tipo: 'servicio_directo', id: 'sd-1' })).toBe('e-2');
    expect(llamadas[0].tabla).toBe('retencion_documento_origenes');
    expect(llamadas[0].metodos.find((m) => m[0] === 'insert')?.[1]).toEqual({ documento_id: 'd-1', servicio_directo_id: 'sd-1' });
  });

  it('la misma orden dos veces → «ya cubre»', async () => {
    cola.push({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "retencion_documento_origenes_unico"' } });
    await expect(cubrirOrigen('d-1', { tipo: 'oc', id: 'oc-2' })).rejects.toThrow(/ya cubre/);
  });

  it('no se quita la principal ni la que salió del archivo de Compras', async () => {
    const principal = { tipo: 'oc' as const, id: 'oc-1' };
    await expect(dejarDeCubrir({ enlaceId: 'e-1', adjuntoId: null }, principal, principal)).rejects.toThrow('principal');
    await expect(dejarDeCubrir({ enlaceId: 'e-1', adjuntoId: 'adj-1' }, principal, { tipo: 'oc', id: 'oc-2' })).rejects.toThrow('archivo');
    expect(llamadas).toHaveLength(0);
    cola.push({ data: [{ id: 'e-3' }], error: null });
    await dejarDeCubrir({ enlaceId: 'e-3', adjuntoId: null }, principal, { tipo: 'oc', id: 'oc-3' });
    expect(llamadas[0].metodos.map((m) => m[0])).toEqual(['delete', 'eq', 'select']);
  });
});

describe('borrar una OC, compra o servicio con factura registrada (P03)', () => {
  it('con una factura registrada se detiene antes de revertir nada', async () => {
    cola.push({ data: [{ id: 'e-1' }], error: null });
    await expect(exigirSinFacturaRegistrada('orden_id', 'oc-1')).rejects.toThrow(TEXTO_ORIGEN_CON_DOCUMENTO);
    expect(llamadas[0].metodos).toContainEqual(['eq', 'orden_id', 'oc-1']);
  });

  it('sin factura registrada sigue; sin P03 ni pregunta', async () => {
    cola.push({ data: [], error: null });
    await expect(exigirSinFacturaRegistrada('compra_directa_id', 'cd-1')).resolves.toBeUndefined();
    conP03 = false; llamadas.length = 0;
    await exigirSinFacturaRegistrada('servicio_directo_id', 'sd-1');
    expect(llamadas).toHaveLength(0);
  });

  it('el rechazo de la base (carrera) se traduce igual; otros errores pasan como vienen', () => {
    expect((errorBorrarOrigen({ code: 'P0001', message: 'RET_ORIGEN_CON_DOCUMENTO: x' }) as Error).message).toBe(TEXTO_ORIGEN_CON_DOCUMENTO);
    const otro = { code: '42501', message: 'permission denied' };
    expect(errorBorrarOrigen(otro)).toBe(otro);
  });
});
