import { beforeEach, describe, expect, it, vi } from 'vitest';

// Simula Supabase: cada respuesta trae como mucho 1.000 filas (su tope por defecto) y respeta
// `.range()`. Los filtros (`.or`, `.eq`) y el orden se ignoran: las filas ya vienen como las
// devolvería la base. Datos inventados.
const { tablas, consulta } = vi.hoisted(() => {
  const tablas: Record<string, Record<string, unknown>[]> = {};
  function consulta(tabla: string) {
    let desde = 0;
    let hasta = 999;
    const q: Record<string, unknown> = {};
    const mismo = () => q;
    Object.assign(q, {
      select: mismo, or: mismo, eq: mismo, order: mismo,
      range: (d: number, h: number) => { desde = d; hasta = h; return q; },
      then: (ok: (v: unknown) => unknown, mal: (e: unknown) => unknown) => {
        const filas = tablas[tabla] ?? [];
        const fin = Math.min(hasta, desde + 999);
        return Promise.resolve({ data: filas.slice(desde, fin + 1), error: null }).then(ok, mal);
      },
    });
    return q;
  }
  return { tablas, consulta };
});
vi.mock('@/shared/lib/supabase', () => ({ supabase: { from: (t: string) => consulta(t) } }));
vi.mock('@/modules/pedidos/compras.repository', () => ({ listComprasConRetencion: async () => [] }));
vi.mock('@/modules/pedidos/ofertas.repository', () => ({ labelCondicionPago: () => 'Contado' }));

import { listRetencionesHechas, listRetencionesPendientes } from './retenciones.repository';

const ordenes = (n: number, extra: Record<string, unknown> = {}) =>
  Array.from({ length: n }, (_, i) => ({ id: `oc-${i + 1}`, codigo: `OP-${i + 1}`, oc_codigo: `OC-${i + 1}`, proveedor_id: `p-${i + 1}`, total: 1, ...extra }));
const proveedores = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p-${i + 1}`, razon_social: `Proveedor de prueba ${i + 1}`, rif: `X-${i + 1}` }));

describe('Retenciones no se corta en las 1.000 filas de Supabase (N3)', () => {
  beforeEach(() => { for (const k of Object.keys(tablas)) delete tablas[k]; });

  it('Por realizar trae todas las OC, aunque pasen de 1.000, en el orden de la base', async () => {
    tablas.ordenes = ordenes(1500);
    tablas.proveedores = proveedores(10);
    const r = await listRetencionesPendientes();
    expect(r).toHaveLength(1500);
    expect(r[0].id).toBe('oc-1');
    expect(r[1499].id).toBe('oc-1500');
  });

  it('Realizadas trae todas las OC finalizadas, aunque pasen de 1.000', async () => {
    tablas.ordenes = ordenes(1200, { retencion_finalizada: true });
    tablas.proveedores = proveedores(10);
    expect(await listRetencionesHechas()).toHaveLength(1200);
  });

  it('el nombre y el RIF salen aunque el proveedor esté pasada la fila 1.000', async () => {
    tablas.ordenes = [{ id: 'oc-x', codigo: 'OP-X', oc_codigo: 'OC-X', proveedor_id: 'p-1250', total: 1 }];
    tablas.proveedores = proveedores(1300);
    const [it0] = await listRetencionesPendientes();
    expect(it0.proveedorNombre).toBe('Proveedor de prueba 1250');
    expect(it0.proveedorRif).toBe('X-1250');
  });
});
