import { describe, expect, it } from 'vitest';
import type { PedidoDelivery } from './delivery';
import {
  armarFeed, debeEnviarUbicacion, distanciaMetros, enChip, errorUbicacion, fueCanceladoPreviamente, mapaHref, mensajeDeEstado, productosTxt, rechazadosPor,
  telHref, trabajoEnCurso, estadoTarjeta, tramoEnCurso,
} from './deliveryMovil';

const base: PedidoDelivery = {
  orden_id: 'o1', oc_codigo: 'OC-2026-0219', codigo: 'SP-2026-0300', total: 120, moneda: 'USD', urgente: false,
  pagada_en: '2026-10-29T20:43:00Z', items: [{ nombre: 'RODAMIENTO 6205', cantidad: 4, unidad: 'und' }],
  notas: null, motivo: null, finalidad: null, almacen_destino: 'General',
  proveedor_id: 'p1', proveedor_nombre: 'FERRETERÍA CARONÍ', proveedor_telefono: '0414-892.11 02',
  proveedor_direccion: 'Av. Las Américas, Puerto Ordaz', proveedor_contacto: null,
  analista_email: 'a@x.com', analista_nombre: 'JAVIER', analista_telefono: '04120000000',
  pedido_id: null, estado: 'por_tomar', repartidor_id: null, repartidor_nombre: null,
  aceptado_en: null, en_ruta_en: null, entregado_en: null, cancelado_en: null,
  motivo_cancel: null, detalle_cancel: null, almacen_entrega: null, nota_entrega: null,
  fotos_recibo: [], fotos_entrega: [], fotos_factura: [], historial: [], es_mio: false,
};
const P = (o: Partial<PedidoDelivery>): PedidoDelivery => ({ ...base, ...o });

describe('Delivery teléfono · ubicación', () => {
  const po = { lat: 8.2869, lng: -62.7467 };

  it('distancia: ~111 m por milésima de grado de latitud', () => {
    expect(distanciaMetros(po, po)).toBe(0);
    const d = distanciaMetros(po, { lat: po.lat + 0.001, lng: po.lng });
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(112);
  });

  it('manda la primera, cada 30 s, o al moverse más de 50 m (no más de una cada 5 s)', () => {
    const t0 = 1_000_000;
    expect(debeEnviarUbicacion(null, { ...po, t: t0 })).toBe(true);
    const ult = { ...po, t: t0 };
    expect(debeEnviarUbicacion(ult, { ...po, t: t0 + 10_000 })).toBe(false);
    expect(debeEnviarUbicacion(ult, { ...po, t: t0 + 30_000 })).toBe(true);
    const lejos = { lat: po.lat + 0.001, lng: po.lng }; // ~111 m
    expect(debeEnviarUbicacion(ult, { ...lejos, t: t0 + 6_000 })).toBe(true);
    expect(debeEnviarUbicacion(ult, { ...lejos, t: t0 + 2_000 })).toBe(false);
    const cerca = { lat: po.lat + 0.0002, lng: po.lng }; // ~22 m
    expect(debeEnviarUbicacion(ult, { ...cerca, t: t0 + 20_000 })).toBe(false);
  });

  it('explica el permiso negado', () => {
    expect(errorUbicacion(1)).toMatch(/Permitir/);
    expect(errorUbicacion(2)).toMatch(/GPS/);
    expect(errorUbicacion(undefined)).toMatch(/No se pudo/);
  });
});

describe('Delivery teléfono · enlaces', () => {
  it('tel: con solo dígitos y el + inicial', () => {
    expect(telHref('0414-892.11 02')).toBe('tel:04148921102');
    expect(telHref('+58 414 892 1102')).toBe('tel:+584148921102');
    expect(telHref('123')).toBeNull();
    expect(telHref(null)).toBeNull();
  });

  it('mapa con la dirección codificada', () => {
    expect(mapaHref('Av. Las Américas, Puerto Ordaz')).toBe(
      'https://www.google.com/maps/search/?api=1&query=Av.%20Las%20Am%C3%A9ricas%2C%20Puerto%20Ordaz',
    );
    expect(mapaHref('  ')).toBeNull();
  });
});

describe('Delivery teléfono · listado', () => {
  const activos = [
    P({ orden_id: 'libre' }),
    P({ orden_id: 'ajeno', estado: 'en_ruta', pedido_id: 'd2', repartidor_nombre: 'ANA' }),
    P({ orden_id: 'mio-acep', estado: 'aceptado', pedido_id: 'd3', es_mio: true }),
    P({ orden_id: 'mio-ruta', estado: 'en_ruta', pedido_id: 'd4', es_mio: true }),
    P({ orden_id: 'relibre', estado: 'cancelado', pedido_id: 'd5', motivo_cancel: 'Avería del vehículo' }),
  ];
  const cerrados = [
    ...activos,
    P({ orden_id: 'ent-viejo', estado: 'entregado', pedido_id: 'd6', entregado_en: '2026-10-28T10:00:00Z', es_mio: true }),
    P({ orden_id: 'ent-nuevo', estado: 'entregado', pedido_id: 'd7', entregado_en: '2026-10-30T10:00:00Z', es_mio: true }),
    P({ orden_id: 'ent-ajeno', estado: 'entregado', pedido_id: 'd9', entregado_en: '2026-10-31T10:00:00Z' }),
    P({ orden_id: 'cerrado-cancel', estado: 'cancelado', pedido_id: 'd8' }),
  ];

  it('lo mío en curso primero (en camino antes), luego por tomar y mis entregados nuevos; lo de otros NO sale', () => {
    const f = armarFeed(activos, cerrados);
    expect(f.map((x) => x.p.orden_id)).toEqual(['mio-ruta', 'mio-acep', 'libre', 'relibre', 'ent-nuevo', 'ent-viejo']);
    expect(f.find((x) => x.p.orden_id === 'relibre')?.disponible).toBe(true);
    expect(f.some((x) => x.p.orden_id === 'ajeno' || x.p.orden_id === 'ent-ajeno')).toBe(false);
  });

  it('chips', () => {
    const f = armarFeed(activos, cerrados);
    const ids = (c: Parameters<typeof enChip>[1]) => f.filter((x) => enChip(x, c)).map((x) => x.p.orden_id);
    expect(ids('por_tomar')).toEqual(['libre', 'relibre']);
    expect(ids('en_ruta')).toEqual(['mio-ruta', 'mio-acep']);
    expect(ids('entregados')).toEqual(['ent-nuevo', 'ent-viejo']);
    expect(ids('todos')).toHaveLength(6);
  });

  it('02/11: lo que marqué «No disponible» ya no me sale (a los demás sí)', () => {
    const rech = [{ orden_id: 'libre', origen: 'compra' as const, repartidor_id: 'yo' }];
    expect(armarFeed(activos, [], rechazadosPor(rech, 'yo')).map((x) => x.p.orden_id)).not.toContain('libre');
    expect(armarFeed(activos, [], rechazadosPor(rech, 'otro')).map((x) => x.p.orden_id)).toContain('libre');
    expect(rechazadosPor(rech, null).size).toBe(0);
  });

  it('02/11: la misma SP con su retiro de Almacén y su OC son dos tarjetas', () => {
    const f = armarFeed([P({ orden_id: 'sp1' }), P({ orden_id: 'sp1', origen: 'almacen', oc_codigo: null })], []);
    expect(f).toHaveLength(2);
    // el «No disponible» del retiro no tapa la OC
    const g = armarFeed([P({ orden_id: 'sp1' }), P({ orden_id: 'sp1', origen: 'almacen' })], [],
      rechazadosPor([{ orden_id: 'sp1', origen: 'almacen', repartidor_id: 'yo' }], 'yo'));
    expect(g.map((x) => x.p.origen ?? 'compra')).toEqual(['compra']);
  });

  it('02/11: cantidad de productos de la tarjeta', () => {
    expect(productosTxt(1)).toBe('📦 1 producto');
    expect(productosTxt(17)).toBe('📦 17 productos');
    expect(productosTxt(0)).toBe('📦 0 productos');
  });

  it('trabajo en curso: el mío en ruta', () => {
    expect(trabajoEnCurso(armarFeed(activos, []))?.orden_id).toBe('mio-ruta');
    expect(trabajoEnCurso(armarFeed([activos[0], activos[1]], []))).toBeNull();
  });
});

describe('Delivery teléfono · mensaje del paso', () => {
  it('usa el nombre guardado, el almacén visible y las horas guardadas', () => {
    const m = mensajeDeEstado(
      P({ estado: 'entregado', repartidor_nombre: 'CARLOS', almacen_entrega: 'General', aceptado_en: '2026-10-30T13:00:00Z', entregado_en: '2026-10-30T13:20:00Z' }),
      'OTRO', (a) => (a === 'General' ? 'MATANZA' : a),
    );
    expect(m?.texto).toContain('👤 *Delivery:* CARLOS');
    expect(m?.texto).toContain('🏬 *Almacén:* MATANZA');
    expect(m?.texto).toContain('20 min');
    expect(mensajeDeEstado(P({ estado: 'cancelado', motivo_cancel: 'Falta de combustible' }), 'YO')?.texto).toContain('Falta de combustible');
    expect(mensajeDeEstado(base, 'YO')).toBeNull();
  });
});

describe('Delivery teléfono · franja de color y tramo (10/11/2026)', () => {
  it('la franja sigue el estado de la tarjeta', () => {
    expect(estadoTarjeta({ p: P({}), disponible: true })).toBe('por_tomar');
    expect(estadoTarjeta({ p: P({ estado: 'en_ruta' }), disponible: false })).toBe('en_camino');
    expect(estadoTarjeta({ p: P({ estado: 'aceptado' }), disponible: false })).toBe('en_camino');
    expect(estadoTarjeta({ p: P({ estado: 'entregado' }), disponible: false })).toBe('entregado');
    expect(estadoTarjeta({ p: P({ estado: 'cancelado' }), disponible: false })).toBe('cancelado');
  });
  it('tramo 1 hasta que sube fotos al recibir; después, tramo 2', () => {
    expect(tramoEnCurso(P({}))).toBe(1);
    expect(tramoEnCurso(P({ fotos_recibo: [{ path: 'a', filename: 'a.jpg' }] }))).toBe(2);
  });
  it('detecta si el pedido fue cancelado o desasignado previamente', () => {
    expect(fueCanceladoPreviamente(P({ estado: 'cancelado', motivo_cancel: 'El proveedor no tiene el pedido listo' }))).toBe(true);
    expect(fueCanceladoPreviamente(P({ estado: 'por_tomar', motivo_cancel: null }))).toBe(false);
  });
});
