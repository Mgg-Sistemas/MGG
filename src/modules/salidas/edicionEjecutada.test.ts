import { describe, expect, it } from 'vitest';
import type { ItemSolicitudSalida, SolicitudSalida } from '@/shared/lib/types';
import { ajustesStockEdicionEjecutada, puedeEditarSolicitudEjecutada } from './edicionEjecutada';

const item = (producto = 'p1', cantidad = 5, almacen = 'General'): ItemSolicitudSalida => ({
  producto_id: producto, producto_nombre: `Producto ${producto}`, cantidad, almacen, unidad: 'und', precio_unit: 2,
});

const solicitud = (patch: Partial<SolicitudSalida> = {}): SolicitudSalida => ({
  id: 's1', codigo: 'SAL-2026-0001', scope: 'salida', tipo: 'material', estado: 'ejecutada',
  solicitante: 'CARLOS', historial: [], created_at: '2026-11-24T20:00:00Z',
  almacen_origen: 'General', mov_id: 'm1', mov_ref: 'salida_modulo', items: [item()], ...patch,
});

describe('edición de salidas/traslados ejecutados · permiso por efectos externos', () => {
  it('permite una salida de material normal y una vieja sin mov_ref', () => {
    expect(puedeEditarSolicitudEjecutada(solicitud())).toBe(true);
    expect(puedeEditarSolicitudEjecutada(solicitud({ mov_ref: null }))).toBe(true);
    expect(puedeEditarSolicitudEjecutada(solicitud({ mov_ref: 'manual_externo', mov_id: null }))).toBe(true);
  });

  it('no mezcla esta edición con dinero, cliente, cocina o Maquinaria', () => {
    expect(puedeEditarSolicitudEjecutada(solicitud({ tipo: 'dinero' }))).toBe(false);
    expect(puedeEditarSolicitudEjecutada(solicitud({ cxc_id: 'c1' }))).toBe(false);
    expect(puedeEditarSolicitudEjecutada(solicitud({ equipo_mant_id: 'e1' }))).toBe(false);
    expect(puedeEditarSolicitudEjecutada(solicitud({ items: [{ ...item(), descuenta_cocina: true }] }))).toBe(false);
    expect(puedeEditarSolicitudEjecutada(solicitud({ items: [{ ...item(), equipo_id: 'e1' }] }))).toBe(false);
  });
});

describe('edición de ejecutados · diferencia de stock', () => {
  it('no mueve nada si las líneas quedan iguales', () => {
    expect(ajustesStockEdicionEjecutada(solicitud(), [item()])).toEqual([]);
  });

  it('una salida con más cantidad descuenta solo lo que falta; con menos, reingresa la diferencia', () => {
    expect(ajustesStockEdicionEjecutada(solicitud(), [item('p1', 8)])).toEqual([
      { producto_id: 'p1', producto_nombre: 'Producto p1', almacen: 'General', delta: -3 },
    ]);
    expect(ajustesStockEdicionEjecutada(solicitud(), [item('p1', 2)])).toEqual([
      { producto_id: 'p1', producto_nombre: 'Producto p1', almacen: 'General', delta: 3 },
    ]);
  });

  it('cambiar producto o almacén devuelve lo viejo y descuenta lo nuevo', () => {
    expect(ajustesStockEdicionEjecutada(solicitud(), [item('p2', 5, 'Los Pinos')])).toEqual([
      { producto_id: 'p1', producto_nombre: 'Producto p1', almacen: 'General', delta: 5 },
      { producto_id: 'p2', producto_nombre: 'Producto p2', almacen: 'Los Pinos', delta: -5 },
    ]);
  });

  it('un traslado con más cantidad ajusta las dos patas por igual', () => {
    const antes = solicitud({ scope: 'traslado', mov_ref: 'traslado_modulo', almacen_destino: 'Los Pinos' });
    expect(ajustesStockEdicionEjecutada(antes, [item('p1', 8)], 'Los Pinos')).toEqual([
      { producto_id: 'p1', producto_nombre: 'Producto p1', almacen: 'General', delta: -3 },
      { producto_id: 'p1', producto_nombre: 'Producto p1', almacen: 'Los Pinos', delta: 3 },
    ]);
  });

  it('cambiar el destino de un traslado lo retira del destino viejo y lo lleva al nuevo', () => {
    const antes = solicitud({ scope: 'traslado', mov_ref: 'traslado_modulo', almacen_destino: 'Los Pinos' });
    expect(ajustesStockEdicionEjecutada(antes, [item()], 'Resguardo')).toEqual([
      { producto_id: 'p1', producto_nombre: 'Producto p1', almacen: 'Los Pinos', delta: -5 },
      { producto_id: 'p1', producto_nombre: 'Producto p1', almacen: 'Resguardo', delta: 5 },
    ]);
  });

  it('cambiar el origen revierte el traslado viejo sin dejar una diferencia en el destino', () => {
    const antes = solicitud({ scope: 'traslado', mov_ref: 'traslado_modulo', almacen_destino: 'Los Pinos' });
    expect(ajustesStockEdicionEjecutada(antes, [item('p1', 5, 'Resguardo')], 'Los Pinos')).toEqual([
      { producto_id: 'p1', producto_nombre: 'Producto p1', almacen: 'General', delta: 5 },
      { producto_id: 'p1', producto_nombre: 'Producto p1', almacen: 'Resguardo', delta: -5 },
    ]);
  });

  it('agrupa renglones repetidos del mismo producto y almacén', () => {
    const antes = solicitud({ items: [item('p1', 2), item('p1', 3)] });
    expect(ajustesStockEdicionEjecutada(antes, [item('p1', 4), item('p1', 4)])).toEqual([
      { producto_id: 'p1', producto_nombre: 'Producto p1', almacen: 'General', delta: -3 },
    ]);
  });
});
