import { describe, expect, it, vi } from 'vitest';
import type { PedidoDelivery } from './delivery';
import {
  calcularRuta, claveRuta, distanciaTxt, duracionTxt, entregaEnLosPinos, masCercano, ordenarDisponibles, ordenarPorCercania,
  paradasRuta, parsearOsrm, puntoLugar, puntoRecogida, rutaRecta, siguienteParada, urlGoogleMapsRuta, urlOsrm, urlWaze, yaRecogido,
  type UbicacionesProveedores,
} from './deliveryRutas';

const yo = { lat: 8.2869, lng: -62.7467 };
const provA = { lat: 8.2969, lng: -62.7467 }; // ~1,1 km al norte
const provB = { lat: 8.3269, lng: -62.7467 }; // ~4,4 km al norte
const pinos = { lat: 8.2700, lng: -62.7600 };
const provs: UbicacionesProveedores = new Map([['A', provA], ['B', provB]]);

const P = (o: Partial<PedidoDelivery>) => ({
  origen: 'compra' as const, proveedor_id: 'A', proveedor_nombre: 'FERRETERÍA A', almacen_destino: 'General', fotos_recibo: [], urgente: false, ...o,
});

describe('Delivery rutas · textos', () => {
  it('distancia en m / km con coma decimal', () => {
    expect(distanciaTxt(null)).toBe('—');
    expect(distanciaTxt(3)).toBe('10 m');
    expect(distanciaTxt(846)).toBe('850 m');
    expect(distanciaTxt(2430)).toBe('2,4 km');
    expect(distanciaTxt(12_400)).toBe('12 km');
  });
  it('duración', () => {
    expect(duracionTxt(null)).toBe('');
    expect(duracionTxt(20)).toBe('≈ 1 min');
    expect(duracionTxt(12 * 60)).toBe('≈ 12 min');
    expect(duracionTxt(65 * 60)).toBe('≈ 1 h 05 min');
  });
});

describe('Delivery rutas · paradas', () => {
  it('lugar fijo sin marcar = null', () => {
    expect(puntoLugar([{ clave: 'los_pinos', nombre: 'x', lat: null, lng: null, actualizado_en: null, actualizado_por: null }], 'los_pinos')).toBeNull();
    expect(puntoLugar([{ clave: 'los_pinos', nombre: 'x', lat: 8.27, lng: -62.76, actualizado_en: null, actualizado_por: null }], 'los_pinos'))
      .toEqual({ lat: 8.27, lng: -62.76 });
  });

  it('recogida: proveedor en compras, Los Pinos en retiros', () => {
    expect(puntoRecogida(P({}), provs, pinos)).toEqual(provA);
    expect(puntoRecogida(P({ proveedor_id: 'Z' }), provs, pinos)).toBeNull();
    expect(puntoRecogida(P({ origen: 'almacen' }), provs, pinos)).toEqual(pinos);
  });

  it('General y Los Pinos se entregan en Los Pinos; otro almacén no tiene punto', () => {
    expect(entregaEnLosPinos({ almacen_destino: null })).toBe(true);
    expect(entregaEnLosPinos({ almacen_destino: 'General' })).toBe(true);
    expect(entregaEnLosPinos({ almacen_destino: 'Almacén Los Pinos' })).toBe(true);
    expect(entregaEnLosPinos({ almacen_destino: 'Depósito Mina' })).toBe(false);
  });

  it('OC: yo → proveedor → Los Pinos; ya recogida: yo → Los Pinos', () => {
    expect(paradasRuta(P({}), yo, provs, pinos).map((x) => x.tipo)).toEqual(['yo', 'recogida', 'entrega']);
    expect(paradasRuta(P({}), yo, provs, pinos)[1].nombre).toBe('FERRETERÍA A');
    const recogida = P({ fotos_recibo: [{ path: 'x', filename: 'x' }] });
    expect(yaRecogido(recogida)).toBe(true);
    expect(paradasRuta(recogida, yo, provs, pinos).map((x) => x.tipo)).toEqual(['yo', 'entrega']);
  });

  it('retiro: yo → Los Pinos (la unidad no tiene punto); sin Los Pinos marcado no hay paradas', () => {
    const r = paradasRuta(P({ origen: 'almacen' }), yo, provs, pinos);
    expect(r.map((x) => [x.tipo, x.nombre])).toEqual([['yo', 'Tú'], ['recogida', 'Almacén Los Pinos']]);
    expect(paradasRuta(P({ origen: 'almacen' }), yo, provs, null).map((x) => x.tipo)).toEqual(['yo']);
  });

  it('sin GPS no hay «yo»; proveedor sin punto se salta', () => {
    expect(paradasRuta(P({}), null, provs, pinos).map((x) => x.tipo)).toEqual(['recogida', 'entrega']);
    expect(paradasRuta(P({ proveedor_id: 'Z' }), yo, provs, pinos).map((x) => x.tipo)).toEqual(['yo', 'entrega']);
  });

  it('proveedor en el mismo sitio que Los Pinos: una sola parada', () => {
    const m: UbicacionesProveedores = new Map([['A', { lat: pinos.lat + 0.0001, lng: pinos.lng }]]);
    expect(paradasRuta(P({}), yo, m, pinos).map((x) => x.tipo)).toEqual(['yo', 'recogida']);
  });
});

describe('Delivery rutas · cercanía', () => {
  const items = [{ id: 'lejos', prov: 'B' }, { id: 'sin', prov: 'Z' }, { id: 'cerca', prov: 'A' }];
  const punto = (x: { prov: string }) => provs.get(x.prov) ?? null;

  it('ordena del más cercano al más lejano, sin punto al final', () => {
    const r = ordenarPorCercania(items, punto, yo);
    expect(r.map((x) => x.item.id)).toEqual(['cerca', 'lejos', 'sin']);
    expect(r[0].metros).toBeGreaterThan(1000);
    expect(r[0].metros).toBeLessThan(1200);
    expect(r[2].metros).toBeNull();
    expect(masCercano(r)?.item.id).toBe('cerca');
  });

  it('sin mi ubicación queda el orden original y no hay más cercano', () => {
    const r = ordenarPorCercania(items, punto, null);
    expect(r.map((x) => x.item.id)).toEqual(['lejos', 'sin', 'cerca']);
    expect(masCercano(r)).toBeNull();
  });

  it('por tomar: urgentes primero y, dentro, por distancia', () => {
    const f = (id: string, urgente: boolean, d: number | null) => ({ id, d, p: { urgente } });
    const lista = [f('n-lejos', false, 5000), f('u-lejos', true, 9000), f('n-sin', false, null), f('n-cerca', false, 100), f('u-cerca', true, 200)];
    expect(ordenarDisponibles(lista, (x) => x.d).map((x) => x.id)).toEqual(['u-cerca', 'u-lejos', 'n-cerca', 'n-lejos', 'n-sin']);
  });
});

describe('Delivery rutas · enlaces y OSRM', () => {
  it('Google Maps: origen, destino y paradas intermedias', () => {
    const u = urlGoogleMapsRuta([yo, provA, pinos]) as string;
    expect(u.startsWith('https://www.google.com/maps/dir/?api=1&')).toBe(true);
    const q = new URL(u).searchParams;
    expect(q.get('origin')).toBe('8.286900,-62.746700');
    expect(q.get('destination')).toBe('8.270000,-62.760000');
    expect(q.get('waypoints')).toBe('8.296900,-62.746700');
    expect(q.get('travelmode')).toBe('driving');
    expect(urlGoogleMapsRuta([yo])).toBeNull();
    // Sin GPS: Google usa la ubicación del teléfono como origen.
    const sin = new URL(urlGoogleMapsRuta([provA], false) as string).searchParams;
    expect(sin.get('origin')).toBeNull();
    expect(sin.get('destination')).toBe('8.296900,-62.746700');
  });

  it('URL de OSRM en lng,lat', () => {
    expect(urlOsrm([yo])).toBeNull();
    expect(urlOsrm([yo, provA])).toBe(
      'https://router.project-osrm.org/route/v1/driving/-62.746700,8.286900;-62.746700,8.296900?overview=full&geometries=geojson&alternatives=false&steps=false',
    );
  });

  it('lee la respuesta de OSRM (y descarta la que no sirve)', () => {
    const ok = { code: 'Ok', routes: [{ distance: 1520.4, duration: 260.1, geometry: { coordinates: [[-62.7467, 8.2869], [-62.7460, 8.2900], [-62.7467, 8.2969]] } }] };
    const r = parsearOsrm(ok);
    expect(r?.fuente).toBe('osrm');
    expect(r?.metros).toBeCloseTo(1520.4);
    expect(r?.segundos).toBeCloseTo(260.1);
    expect(r?.linea[0]).toEqual([8.2869, -62.7467]);
    expect(parsearOsrm({ code: 'NoRoute', routes: [] })).toBeNull();
    expect(parsearOsrm(null)).toBeNull();
    expect(parsearOsrm({ code: 'Ok', routes: [{ distance: 1, geometry: { coordinates: [[1, 2]] } }] })).toBeNull();
  });

  it('línea recta = suma de tramos, sin tiempo', () => {
    const r = rutaRecta([yo, provA, provB]);
    expect(r.fuente).toBe('recta');
    expect(r.segundos).toBeNull();
    expect(r.metros).toBeGreaterThan(4300);
    expect(r.metros).toBeLessThan(4500);
    expect(r.linea).toHaveLength(3);
  });

  it('clave de caché a 4 decimales', () => {
    expect(claveRuta([yo, provA])).toBe('8.2869,-62.7467;8.2969,-62.7467');
    expect(claveRuta([{ lat: 8.28691, lng: -62.74671 }])).toBe(claveRuta([{ lat: 8.28689, lng: -62.74669 }]));
  });

  it('calcularRuta: usa OSRM, guarda en caché y si falla da la línea recta', async () => {
    const ok = { code: 'Ok', routes: [{ distance: 2000, duration: 300, geometry: { coordinates: [[-62.70, 8.20], [-62.71, 8.21]] } }] };
    const f1 = vi.fn(async () => new Response(JSON.stringify(ok), { status: 200 }));
    const a = { lat: 8.2, lng: -62.7 };
    const b = { lat: 8.21, lng: -62.71 };
    const r1 = await calcularRuta([a, b], f1 as unknown as typeof fetch);
    expect(r1.fuente).toBe('osrm');
    const r2 = await calcularRuta([a, b], f1 as unknown as typeof fetch);
    expect(r2).toBe(r1);
    expect(f1).toHaveBeenCalledTimes(1);
    const falla = vi.fn(async () => { throw new Error('sin red'); });
    const r3 = await calcularRuta([a, { lat: 8.3, lng: -62.8 }], falla as unknown as typeof fetch);
    expect(r3.fuente).toBe('recta');
  });
});

describe('Delivery rutas · Waze y siguiente parada (10/11/2026)', () => {
  it('Waze navega al punto; sin punto válido no hay enlace', () => {
    expect(urlWaze(provA)).toBe('https://waze.com/ul?ll=8.296900,-62.746700&navigate=yes');
    expect(urlWaze(null)).toBeNull();
    expect(urlWaze({ lat: Number.NaN, lng: 1 })).toBeNull();
  });
  it('sin recoger, la siguiente parada es el proveedor; ya recogido, el almacén', () => {
    expect(siguienteParada(P({}), provs, pinos)?.tipo).toBe('recogida');
    const recogido = siguienteParada(P({ fotos_recibo: [{ path: 'x', filename: 'x.jpg' }] }), provs, pinos);
    expect(recogido?.tipo).toBe('entrega');
    expect(siguienteParada(P({ proveedor_id: 'Z' }), provs, null)).toBeNull();
  });
});
