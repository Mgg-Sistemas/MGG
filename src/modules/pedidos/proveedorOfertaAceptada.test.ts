/* Corregir el proveedor de una oferta aceptada (29-10-2026): la regla pura y el repositorio con
   Supabase simulado. Datos inventados; el caso es el de SV-2026-0021 (una orden de servicio con
   su oferta aceptada a la que se le corrigió el proveedor sin que la orden se enterara). */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrdenDeOferta } from './proveedorOfertaAceptada';

/* ───────── Supabase simulado: respuestas en cola por tabla, y registro de lo que se pidió ───────── */
const llamadas: { tabla: string; metodos: unknown[][] }[] = [];
let colas: Record<string, Array<{ data: unknown; error: unknown }>> = {};

function consulta(tabla: string) {
  const reg = { tabla, metodos: [] as unknown[][] };
  llamadas.push(reg);
  const q: Record<string, unknown> = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') {
        return (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => {
          const r = colas[tabla]?.shift() ?? { data: null, error: { message: `sin respuesta para ${tabla}` } };
          return Promise.resolve(r).then(ok, ko);
        };
      }
      return (...args: unknown[]) => { reg.metodos.push([prop, ...args]); return q; };
    },
  });
  return q;
}

vi.mock('@/shared/lib/supabase', () => ({ supabase: { from: (t: string) => consulta(t) } }));
vi.mock('@/modules/inventario/inventario.repository', () => ({ createProducto: vi.fn(), siguienteSkuLibre: vi.fn() }));
vi.mock('@/modules/inventario/CategoriaProductoSelect', () => ({ asegurarCategoria: vi.fn() }));

import { actualizarOferta } from './ofertas.repository';
import { decidirCambioProveedor, errorMotivoProveedorOferta, eventoProveedorCambiado } from './proveedorOfertaAceptada';

const ANTERIOR = { id: 'prov-a', razon_social: 'SERVICIOS EJEMPLO UNO, C.A.', rif: 'J-000000001' };
const NUEVO = { id: 'prov-b', razon_social: 'TALLER EJEMPLO DOS', rif: 'J-000000002' };

const orden = (x: Partial<OrdenDeOferta> = {}): OrdenDeOferta => ({
  id: 'ord-1', codigo: 'SV-2026-0021', oc_codigo: 'OC-2026-0100', estado: 'oc_aprobada', proveedor_id: 'prov-a',
  parent_orden_id: null, items: [{ sku: 'SERV-1', nombre: 'MANTENIMIENTO', cantidad: 1, precio: 100 } as never],
  historial: [{ at: '2026-10-28T12:00:00Z', evento: 'oc_creada', actor: 'analista@ejemplo.test' }], ...x,
});
const aceptada = { estado: 'aceptada', proveedor_id: 'prov-a', orden_id: 'ord-1' };

describe('la regla: qué pasa con la orden', () => {
  it('oferta aceptada y orden antes del pago: se sincroniza su orden', () => {
    const d = decidirCambioProveedor(aceptada, 'prov-b', [orden()]);
    expect(d).toEqual({ tipo: 'sincronizar', ordenes: [orden()] });
  });

  it('multi-proveedor: solo la sub-OC del proveedor de la oferta, no la madre ni las otras', () => {
    const madre = orden({ estado: 'asignada', proveedor_id: null });
    const suya = orden({ id: 'h-1', codigo: 'SP-2026-0200-1', parent_orden_id: 'ord-1', estado: 'oc_creada' });
    const otra = orden({ id: 'h-2', codigo: 'SP-2026-0200-2', parent_orden_id: 'ord-1', proveedor_id: 'prov-z', estado: 'pagada' });
    const d = decidirCambioProveedor(aceptada, 'prov-b', [madre, suya, otra]);
    expect(d.tipo === 'sincronizar' && d.ordenes.map((o) => o.id)).toEqual(['h-1']);
  });

  it('orden pagada, recibida o finalizada: se rechaza con un mensaje claro', () => {
    for (const estado of ['pagada', 'recibida', 'finalizada'] as const) {
      const d = decidirCambioProveedor(aceptada, 'prov-b', [orden({ estado })]);
      expect(d).toEqual({ tipo: 'bloqueado', mensaje: `La orden OC-2026-0100 ya está ${estado}: el proveedor de su oferta aceptada ya no se puede cambiar.` });
    }
  });

  it('con mercancía recibida en parte también se rechaza', () => {
    const d = decidirCambioProveedor(aceptada, 'prov-b', [orden({ estado: 'por_recibir', items: [{ sku: 'X', nombre: 'X', cantidad: 4, precio: 1, cantidad_recibida: 1 } as never] })]);
    expect(d.tipo).toBe('bloqueado');
  });

  it('una orden anulada no cuenta: ni se sincroniza ni bloquea', () => {
    expect(decidirCambioProveedor(aceptada, 'prov-b', [orden({ estado: 'anulada' })])).toEqual({ tipo: 'sincronizar', ordenes: [] });
  });

  it('oferta no aceptada, o sin cambio de proveedor: solo la oferta, como siempre', () => {
    expect(decidirCambioProveedor({ ...aceptada, estado: 'pendiente' }, 'prov-b', [orden({ estado: 'pagada' })])).toEqual({ tipo: 'solo_oferta' });
    expect(decidirCambioProveedor(aceptada, 'prov-a', [orden()])).toEqual({ tipo: 'solo_oferta' });
  });

  it('el motivo es obligatorio, en español y sin voseo', () => {
    expect(errorMotivoProveedorOferta('')).toBe('Indique el motivo del cambio de proveedor: la oferta ya está aceptada y el cambio pasa a la orden.');
    expect(errorMotivoProveedorOferta('ok')).toMatch(/corto/);
    expect(errorMotivoProveedorOferta('RIF equivocado al cargar')).toBeNull();
  });

  it('el evento lleva de quién a quién (nombre y RIF), el motivo y el actor, y no devuelve la orden a aprobación', () => {
    const e = eventoProveedorCambiado({ anterior: ANTERIOR, nuevo: NUEVO, motivo: 'Se cargó al proveedor equivocado', actor: 'ana@ejemplo.test', at: '2026-10-29T14:00:00Z' });
    expect(e).toEqual({
      at: '2026-10-29T14:00:00Z', evento: 'proveedor_cambiado', actor: 'ana@ejemplo.test', desde: 'oferta_aceptada',
      proveedorAnteriorId: 'prov-a', proveedorNuevoId: 'prov-b',
      proveedorAnterior: 'SERVICIOS EJEMPLO UNO, C.A. · J-000000001', proveedorNuevo: 'TALLER EJEMPLO DOS · J-000000002',
      motivo: 'Se cargó al proveedor equivocado',
    });
  });
});

/* ───────── El repositorio ───────── */

const updates = (tabla: string) => llamadas.filter((l) => l.tabla === tabla && l.metodos.some((m) => m[0] === 'update'))
  .map((l) => l.metodos.find((m) => m[0] === 'update')![1] as Record<string, unknown>);

beforeEach(() => { llamadas.length = 0; colas = {}; });

describe('actualizarOferta con cambio de proveedor', () => {
  it('SV-2026-0021: la oferta aceptada cambia de proveedor y la orden también, con su evento en el historial', async () => {
    colas = {
      ofertas_proveedor: [
        { data: aceptada, error: null },
        { data: { id: 'of-1', ...aceptada, proveedor_id: 'prov-b' }, error: null },
      ],
      ordenes: [
        { data: [orden()], error: null },
        { data: { ...orden(), proveedor_id: 'prov-b' }, error: null },
      ],
      proveedores: [{ data: [ANTERIOR, NUEVO], error: null }],
    };
    const r = await actualizarOferta('of-1', { proveedor_id: 'prov-b', notas: 'x' }, { actor: 'ana@ejemplo.test', motivoCambioProveedor: 'Se cargó al proveedor equivocado' });
    expect(updates('ofertas_proveedor')).toEqual([{ proveedor_id: 'prov-b', notas: 'x' }]);
    const [patchOrden] = updates('ordenes');
    expect(patchOrden.proveedor_id).toBe('prov-b');
    const historial = patchOrden.historial as Array<Record<string, unknown>>;
    expect(historial).toHaveLength(2);
    expect(historial[0].evento).toBe('oc_creada');
    expect(historial[1]).toMatchObject({
      evento: 'proveedor_cambiado', actor: 'ana@ejemplo.test', proveedorAnteriorId: 'prov-a', proveedorNuevoId: 'prov-b',
      proveedorAnterior: 'SERVICIOS EJEMPLO UNO, C.A. · J-000000001', proveedorNuevo: 'TALLER EJEMPLO DOS · J-000000002',
      motivo: 'Se cargó al proveedor equivocado',
    });
    expect(patchOrden).not.toHaveProperty('estado');
    expect(r.ordenes_sincronizadas?.map((o) => o.proveedor_id)).toEqual(['prov-b']);
  });

  it('sin motivo no se toca nada', async () => {
    colas = { ofertas_proveedor: [{ data: aceptada, error: null }], ordenes: [{ data: [orden()], error: null }] };
    await expect(actualizarOferta('of-1', { proveedor_id: 'prov-b' }, { actor: 'ana@ejemplo.test' })).rejects.toThrow('Indique el motivo');
    expect(updates('ofertas_proveedor')).toEqual([]);
    expect(updates('ordenes')).toEqual([]);
  });

  it('con la orden pagada o recibida se rechaza ANTES de cambiar la oferta', async () => {
    for (const estado of ['pagada', 'recibida'] as const) {
      llamadas.length = 0;
      colas = { ofertas_proveedor: [{ data: aceptada, error: null }], ordenes: [{ data: [orden({ estado })], error: null }] };
      await expect(actualizarOferta('of-1', { proveedor_id: 'prov-b' }, { actor: 'ana@ejemplo.test', motivoCambioProveedor: 'Se cargó al proveedor equivocado' }))
        .rejects.toThrow(`ya está ${estado}`);
      expect(updates('ofertas_proveedor')).toEqual([]);
      expect(updates('ordenes')).toEqual([]);
    }
  });

  it('oferta no aceptada: se edita como siempre, sin motivo y sin tocar la orden', async () => {
    colas = {
      ofertas_proveedor: [
        { data: { ...aceptada, estado: 'pendiente' }, error: null },
        { data: { id: 'of-1', ...aceptada, estado: 'pendiente', proveedor_id: 'prov-b' }, error: null },
      ],
    };
    const r = await actualizarOferta('of-1', { proveedor_id: 'prov-b' });
    expect(updates('ofertas_proveedor')).toEqual([{ proveedor_id: 'prov-b' }]);
    expect(llamadas.some((l) => l.tabla === 'ordenes')).toBe(false);
    expect(r.ordenes_sincronizadas).toBeUndefined();
  });

  it('sin cambio de proveedor ni siquiera consulta la orden', async () => {
    colas = { ofertas_proveedor: [{ data: { id: 'of-1', ...aceptada }, error: null }] };
    await actualizarOferta('of-1', { notas: 'solo la nota' });
    expect(llamadas.map((l) => l.tabla)).toEqual(['ofertas_proveedor']);
  });
});
