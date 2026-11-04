import { describe, expect, it } from 'vitest';
import type { PedidoDelivery } from './delivery';
import {
  DESTINOS_POR_DEFECTO, debeRecalcularRuta, googleMapsHref, leerRutaOsrm, lineaRecta, marcaRuta, paradasDelPedido,
  proveedoresCercanos, proximaParada, puntosRuta, wazeHref,
} from './deliveryRutas';

const yo = { lat: 8.28, lng: -62.75 };
const cerca = { lat: 8.285, lng: -62.75 };
const lejos = { lat: 8.35, lng: -62.75 };

describe('rutas de Delivery (03-11-2026)', () => {
  it('ordena los proveedores con OC por tomar del más cercano al más lejano', () => {
    const libres = [
      { proveedor_id: 'L', proveedor_nombre: 'LEJOS', tipo: 'oc' },
      { proveedor_id: 'C', proveedor_nombre: 'CERCA', tipo: 'oc' },
      { proveedor_id: 'C', proveedor_nombre: 'CERCA', tipo: 'oc' },
      { proveedor_id: 'X', proveedor_nombre: 'SIN UBICAR', tipo: 'oc' },
    ] as Array<Pick<PedidoDelivery, 'proveedor_id' | 'proveedor_nombre' | 'tipo'>>;
    const r = proveedoresCercanos(yo, libres, new Map([['L', lejos], ['C', cerca]]));
    expect(r.map((c) => c.nombre)).toEqual(['CERCA', 'LEJOS']);
    expect(r[0].pedidos).toBe(2);
    expect(proveedoresCercanos(null, libres, new Map([['C', cerca]]))).toEqual([]);
  });

  it('la ruta va yo → proveedor → almacén, y directo al almacén si ya recogió', () => {
    const destinos = { ...DESTINOS_POR_DEFECTO, MATANZA: { clave: 'MATANZA' as const, lat: 8.29, lng: -62.83, aproximada: false } };
    const p = { proveedor_id: 'C', tipo: 'oc', almacen_destino: 'General', almacen_entrega: null, fotos_recibo: [] } as unknown as PedidoDelivery;
    const paradas = paradasDelPedido(p, new Map([['C', cerca]]), destinos);
    expect(paradas.destinoClave).toBe('MATANZA');
    expect(puntosRuta(yo, paradas)).toHaveLength(3);
    expect(proximaParada(paradas)).toEqual(cerca);
    const recogido = { ...paradas, recogido: true };
    expect(puntosRuta(yo, recogido)).toHaveLength(2);
    expect(proximaParada(recogido)).toEqual({ lat: 8.29, lng: -62.83 });
  });

  it('arma los enlaces de Google Maps y Waze', () => {
    const g = googleMapsHref(lejos, [cerca], yo);
    expect(g).toContain('destination=8.350000%2C-62.750000');
    expect(g).toContain('waypoints=8.285000%2C-62.750000');
    expect(wazeHref(cerca)).toBe('https://waze.com/ul?ll=8.285000%2C-62.750000&navigate=yes');
  });

  it('lee OSRM y, si no, usa la línea recta', () => {
    const ok = leerRutaOsrm({ code: 'Ok', routes: [{ distance: 1200, duration: 180, geometry: { coordinates: [[-62.75, 8.28], [-62.75, 8.285]] } }] });
    expect(ok).toMatchObject({ metros: 1200, segundos: 180, fuente: 'osrm' });
    expect(leerRutaOsrm({ code: 'NoRoute' })).toBeNull();
    expect(lineaRecta([yo, cerca]).fuente).toBe('recta');
  });

  it('no vuelve a pedir la ruta por moverse poco', () => {
    const paradas = { origen: cerca, destino: lejos, destinoClave: 'MATANZA' as const, recogido: false };
    const a = marcaRuta(yo, paradas, 0);
    expect(debeRecalcularRuta(null, a)).toBe(true);
    expect(debeRecalcularRuta(a, marcaRuta({ lat: 8.2801, lng: -62.75 }, paradas, 60_000))).toBe(false);
    expect(debeRecalcularRuta(a, marcaRuta(yo, { ...paradas, recogido: true }, 1_000))).toBe(true);
  });
});
