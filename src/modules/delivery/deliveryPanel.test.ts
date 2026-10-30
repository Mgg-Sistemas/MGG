import { describe, it, expect } from 'vitest';
import {
  armarFilasHistorial, conteoPorEstado, duracionTxt, escaparHtml, filtrarPorRepartidor, mensajeDelPedido, rangoDelivery,
  rangoDeliveryActivo, repartidoresDe, resumenHistorial, sePuedeCancelar, totalesResumen, ubicacionVieja,
} from './deliveryPanel';
import { UBICACION_VIEJA_MS, type PedidoDelivery } from './delivery';

const pedido = (x: Partial<PedidoDelivery> = {}): PedidoDelivery => ({
  orden_id: 'o1', oc_codigo: 'OC-2026-0001', codigo: 'SP-1', total: 120, moneda: 'USD', urgente: false, pagada_en: null,
  items: [{ nombre: 'Tornillo', cantidad: 4, unidad: 'und' }], notas: null, motivo: null, finalidad: null,
  almacen_destino: 'LOS PINOS', proveedor_id: 'p1', proveedor_nombre: 'Ferretería X', proveedor_telefono: null,
  proveedor_direccion: null, proveedor_contacto: null, analista_email: null, analista_nombre: null, analista_telefono: null,
  pedido_id: 'd1', estado: 'aceptado', repartidor_id: 'u1', repartidor_nombre: 'Pedro', aceptado_en: '2026-10-30T12:00:00Z',
  en_ruta_en: null, entregado_en: null, cancelado_en: null, motivo_cancel: null, detalle_cancel: null, almacen_entrega: null,
  nota_entrega: null, fotos_recibo: [], fotos_entrega: [], historial: [], es_mio: false, ...x,
});

describe('rangoDelivery · Hoy / Esta semana / Este mes', () => {
  it('hoy es el mismo día', () => {
    expect(rangoDelivery('hoy', '2026-10-30')).toEqual({ desde: '2026-10-30', hasta: '2026-10-30' });
  });
  it('la semana arranca el lunes (30-10-2026 es viernes → lunes 26)', () => {
    expect(rangoDelivery('semana', '2026-10-30')).toEqual({ desde: '2026-10-26', hasta: '2026-10-30' });
  });
  it('un domingo pertenece a la semana que empezó el lunes anterior', () => {
    expect(rangoDelivery('semana', '2026-11-01')).toEqual({ desde: '2026-10-26', hasta: '2026-11-01' });
  });
  it('un lunes es su propio inicio, aunque cruce de mes', () => {
    expect(rangoDelivery('semana', '2026-11-02')).toEqual({ desde: '2026-11-02', hasta: '2026-11-02' });
    expect(rangoDelivery('semana', '2026-12-03')).toEqual({ desde: '2026-11-30', hasta: '2026-12-03' });
  });
  it('el mes desde el día 1', () => {
    expect(rangoDelivery('mes', '2026-10-30')).toEqual({ desde: '2026-10-01', hasta: '2026-10-30' });
  });
  it('marca el chip activo', () => {
    expect(rangoDeliveryActivo('2026-10-26', '2026-10-30', '2026-10-30')).toBe('semana');
    expect(rangoDeliveryActivo('2026-10-02', '2026-10-30', '2026-10-30')).toBeNull();
  });
});

describe('Tablero', () => {
  it('cuenta por estado', () => {
    const c = conteoPorEstado([{ estado: 'por_tomar' }, { estado: 'por_tomar' }, { estado: 'en_ruta' }, { estado: 'entregado' }]);
    expect(c).toEqual({ por_tomar: 2, aceptado: 0, en_ruta: 1, entregado: 1, cancelado: 0 });
  });
  it('solo se cancela lo tomado y sin entregar', () => {
    expect(sePuedeCancelar({ estado: 'aceptado', pedido_id: 'd' })).toBe(true);
    expect(sePuedeCancelar({ estado: 'en_ruta', pedido_id: 'd' })).toBe(true);
    expect(sePuedeCancelar({ estado: 'por_tomar', pedido_id: null })).toBe(false);
    expect(sePuedeCancelar({ estado: 'entregado', pedido_id: 'd' })).toBe(false);
    expect(sePuedeCancelar({ estado: 'aceptado', pedido_id: null })).toBe(false);
  });
  it('arma el mensaje del último paso; sin tomar no hay mensaje', () => {
    expect(mensajeDelPedido(pedido())?.texto).toContain('PEDIDO ACEPTADO');
    expect(mensajeDelPedido(pedido({ estado: 'en_ruta', en_ruta_en: '2026-10-30T12:10:00Z' }))?.texto).toContain('EN RUTA');
    const e = mensajeDelPedido(pedido({ estado: 'entregado', almacen_entrega: 'MATANZA', entregado_en: '2026-10-30T12:45:00Z' }));
    expect(e?.texto).toContain('MATANZA');
    expect(e?.texto).toContain('45 min');
    expect(mensajeDelPedido(pedido({ estado: 'cancelado', motivo_cancel: 'Avería del vehículo' }))?.texto).toContain('Avería del vehículo');
    expect(mensajeDelPedido(pedido({ estado: 'por_tomar', pedido_id: null }))).toBeNull();
  });
  it('duración legible', () => {
    expect(duracionTxt(null)).toBe('—');
    expect(duracionTxt(45)).toBe('45 min');
    expect(duracionTxt(65)).toBe('1 h 05 min');
  });
});

describe('Mapa', () => {
  it('sin señal reciente pasado el umbral, o sin fecha', () => {
    const ahora = Date.parse('2026-10-30T12:00:00Z');
    expect(ubicacionVieja(new Date(ahora - 60_000).toISOString(), ahora)).toBe(false);
    expect(ubicacionVieja(new Date(ahora - UBICACION_VIEJA_MS - 1000).toISOString(), ahora)).toBe(true);
    expect(ubicacionVieja(null, ahora)).toBe(true);
  });
  it('escapa el HTML del nombre', () => {
    expect(escaparHtml('<b>"Jo" & \'Al\'</b>')).toBe('&lt;b&gt;&quot;Jo&quot; &amp; &#39;Al&#39;&lt;/b&gt;');
    expect(escaparHtml(null)).toBe('');
  });
});

describe('Histórico y resumen por delivery', () => {
  const base = {
    repartidor_email: null, en_ruta_en: null, entregado_en: null, cancelado_en: null, motivo_cancel: null, almacen_entrega: null,
  };
  const rows = [
    { ...base, id: 'a', orden_id: 'o1', estado: 'entregado', repartidor_nombre: 'Pedro', aceptado_en: '2026-10-30T12:00:00Z', entregado_en: '2026-10-30T12:30:00Z', almacen_entrega: 'LOS PINOS', orden: { oc_codigo: 'OC-1', codigo: 'SP-1', total: 10, moneda: 'USD', proveedor_id: 'p1' } },
    { ...base, id: 'b', orden_id: 'o2', estado: 'entregado', repartidor_nombre: 'Pedro', aceptado_en: '2026-10-30T13:00:00Z', entregado_en: '2026-10-30T14:00:00Z', orden: { oc_codigo: null, codigo: 'SP-2', total: 5, moneda: 'BS', proveedor_id: 'zz' } },
    { ...base, id: 'c', orden_id: 'o3', estado: 'cancelado', repartidor_nombre: 'Ana', aceptado_en: '2026-10-30T09:00:00Z', motivo_cancel: 'Avería del vehículo', orden: null },
    { ...base, id: 'd', orden_id: 'o3', estado: 'en_ruta', repartidor_nombre: 'Ana', aceptado_en: '2026-10-30T10:00:00Z', orden: null },
  ];
  const filas = armarFilasHistorial(rows, new Map([['p1', 'Ferretería X']]));

  it('pone el proveedor, la OC (o el código) y el tiempo de entrega', () => {
    expect(filas[0]).toMatchObject({ oc: 'OC-1', proveedor: 'Ferretería X', minutos: 30, total: 10 });
    expect(filas[1]).toMatchObject({ oc: 'SP-2', proveedor: '—', minutos: 60, moneda: 'BS' });
    expect(filas[2]).toMatchObject({ oc: '—', minutos: null, estado: 'cancelado' });
  });

  it('lista y filtra por delivery', () => {
    expect(repartidoresDe(filas)).toEqual(['Ana', 'Pedro']);
    expect(filtrarPorRepartidor(filas, 'Ana').map((f) => f.id)).toEqual(['c', 'd']);
    expect(filtrarPorRepartidor(filas, '')).toHaveLength(4);
  });

  it('resume por delivery: entregados, cancelados, en curso y promedio', () => {
    const r = resumenHistorial(filas);
    expect(r).toEqual([
      { repartidor: 'Pedro', entregados: 2, cancelados: 0, enCurso: 0, minutosPromedio: 45 },
      { repartidor: 'Ana', entregados: 0, cancelados: 1, enCurso: 1, minutosPromedio: null },
    ]);
    expect(totalesResumen(r)).toEqual({ entregados: 2, cancelados: 1, enCurso: 1, minutosPromedio: 45 });
  });
});
