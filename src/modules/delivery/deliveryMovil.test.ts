import { describe, expect, it } from 'vitest';
import type { PedidoDelivery } from './delivery';
import {
  armarFeed, debeEnviarUbicacion, distanciaMetros, enChip, errorUbicacion, mapaHref, mensajeDeEstado, telHref, trabajoEnCurso,
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
  fotos_recibo: [], fotos_entrega: [], historial: [], es_mio: false,
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
    P({ orden_id: 'ajeno', estado: 'aceptado', pedido_id: 'd2', repartidor_nombre: 'ANA' }),
    P({ orden_id: 'mio-acep', estado: 'aceptado', pedido_id: 'd3', es_mio: true }),
    P({ orden_id: 'mio-ruta', estado: 'en_ruta', pedido_id: 'd4', es_mio: true }),
    P({ orden_id: 'relibre', estado: 'cancelado', pedido_id: 'd5', motivo_cancel: 'Avería del vehículo' }),
  ];
  const cerrados = [
    ...activos,
    P({ orden_id: 'ent-viejo', estado: 'entregado', pedido_id: 'd6', entregado_en: '2026-10-28T10:00:00Z' }),
    P({ orden_id: 'ent-nuevo', estado: 'entregado', pedido_id: 'd7', entregado_en: '2026-10-30T10:00:00Z' }),
    P({ orden_id: 'cerrado-cancel', estado: 'cancelado', pedido_id: 'd8' }),
  ];

  it('lo mío en curso primero (en ruta antes), luego por tomar, lo ajeno y los entregados nuevos', () => {
    const f = armarFeed(activos, cerrados);
    expect(f.map((x) => x.p.orden_id)).toEqual(['mio-ruta', 'mio-acep', 'libre', 'relibre', 'ajeno', 'ent-nuevo', 'ent-viejo']);
    expect(f.find((x) => x.p.orden_id === 'relibre')?.disponible).toBe(true);
    expect(f.find((x) => x.p.orden_id === 'ajeno')?.disponible).toBe(false);
  });

  it('chips', () => {
    const f = armarFeed(activos, cerrados);
    const ids = (c: Parameters<typeof enChip>[1]) => f.filter((x) => enChip(x, c)).map((x) => x.p.orden_id);
    expect(ids('por_tomar')).toEqual(['libre', 'relibre']);
    expect(ids('en_ruta')).toEqual(['mio-ruta', 'mio-acep', 'ajeno']);
    expect(ids('entregados')).toEqual(['ent-nuevo', 'ent-viejo']);
    expect(ids('todos')).toHaveLength(7);
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
