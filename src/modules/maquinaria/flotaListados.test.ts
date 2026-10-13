import { describe, it, expect } from 'vitest';
import {
  diaLocal, enRango, coincideTexto, filtrarOrdenes, contarPorEstado, equiposEnAtencion, filtrarEventos,
  filtrarLavados, equiposSinLavar, piezasNuevasPendientes, ordenesConRepuestos, equipoAdmite, columnaSalidaDeOrden, columnaCompraDeOrden,
} from './flotaListados';

const eq = (id: string, equipo: string, extra: Record<string, unknown> = {}) => ({ id, equipo, status: 'ACTIVO', activo: true, ...extra });
const equipos = new Map([
  ['a', eq('a', 'EXCAVADORA CAT 320', { marca: 'CATERPILLAR' })],
  ['b', eq('b', 'CAMIÓN VOLTEO MACK', { marca: 'MACK' })],
]);

describe('fechas', () => {
  it('día local y rango inclusive', () => {
    const iso = new Date(2026, 9, 9, 23, 30).toISOString();
    expect(diaLocal(iso)).toBe('2026-10-09');
    expect(enRango(iso, '2026-10-09', '2026-10-09')).toBe(true);
    expect(enRango(iso, '2026-10-10', null)).toBe(false);
    expect(enRango(iso, null, '2026-10-08')).toBe(false);
    expect(enRango(null, '2026-10-01', null)).toBe(false);
    expect(enRango(null, '', '')).toBe(true);
  });
  it('búsqueda sin acentos y por palabras', () => {
    expect(coincideTexto(['CAMIÓN VOLTEO', 'MACK'], 'camion mack')).toBe(true);
    expect(coincideTexto(['CAMIÓN VOLTEO'], 'cat')).toBe(false);
  });
});

describe('órdenes de servicio', () => {
  const o = (id: string, extra: Record<string, unknown>) => ({
    id, codigo: `OS-2026-000${id}`, equipo_id: 'a', tipo: 'reparacion', urgencia: 'normal', estado: 'abierta',
    descripcion: null, responsable: null, created_at: new Date(2026, 9, 5).toISOString(), repuestos: [], ...extra,
  });
  const ordenes = [
    o('1', {}),
    o('2', { estado: 'repuestos', urgencia: 'urgente', repuestos: [{ nombre: 'SELLO GATO' }] }),
    o('3', { estado: 'realizada', equipo_id: 'b', tipo: 'cauchos', created_at: new Date(2026, 8, 1).toISOString() }),
    o('4', { estado: 'anulada' }),
  ];
  it('pestaña abiertas, por estado y todas', () => {
    expect(filtrarOrdenes(ordenes, equipos, { estado: 'abiertas' }).map((x) => x.id)).toEqual(['1', '2']);
    expect(filtrarOrdenes(ordenes, equipos, { estado: 'realizada' }).map((x) => x.id)).toEqual(['3']);
    expect(filtrarOrdenes(ordenes, equipos, { estado: 'todas' })).toHaveLength(4);
  });
  it('filtros por equipo, tipo, urgencia, fechas y texto (también en repuestos)', () => {
    expect(filtrarOrdenes(ordenes, equipos, { equipoId: 'b' }).map((x) => x.id)).toEqual(['3']);
    expect(filtrarOrdenes(ordenes, equipos, { tipo: 'cauchos' }).map((x) => x.id)).toEqual(['3']);
    expect(filtrarOrdenes(ordenes, equipos, { urgencia: 'urgente' }).map((x) => x.id)).toEqual(['2']);
    expect(filtrarOrdenes(ordenes, equipos, { desde: '2026-10-01' }).map((x) => x.id)).toEqual(['1', '2', '4']);
    expect(filtrarOrdenes(ordenes, equipos, { q: 'sello' }).map((x) => x.id)).toEqual(['2']);
    expect(filtrarOrdenes(ordenes, equipos, { q: 'camion' }).map((x) => x.id)).toEqual(['3']);
  });
  it('conteo por estado', () => {
    expect(contarPorEstado(ordenes)).toMatchObject({ abiertas: 2, todas: 4, abierta: 1, repuestos: 1, realizada: 1, anulada: 1 });
  });
});

describe('averías y estados', () => {
  it('lista solo lo que necesita atención, averiados primero', () => {
    const lista = equiposEnAtencion([
      eq('1', 'Z ESPERA', { estado_operativo: 'espera' }),
      eq('2', 'OPERATIVA'),
      eq('3', 'TALLER VIEJO', { status: 'MANTENIMIENTO' }),
      eq('4', 'AVERIADA', { estado_operativo: 'averiada' }),
      eq('5', 'RETIRADA', { activo: false }),
    ]);
    expect(lista.map((e) => e.equipo)).toEqual(['AVERIADA', 'TALLER VIEJO', 'Z ESPERA']);
  });
  it('historial filtrado por estado, equipo, fecha y motivo', () => {
    const evs = [
      { equipo_id: 'a', estado: 'averiada', estado_anterior: 'operativa', motivo: 'se le dañó el gato', material: null, nota: null, actor: null, actor_name: 'ANA', created_at: new Date(2026, 9, 8).toISOString() },
      { equipo_id: 'b', estado: 'espera', estado_anterior: 'operativa', motivo: 'sin frente', material: null, nota: null, actor: null, actor_name: null, created_at: new Date(2026, 9, 1).toISOString() },
    ];
    expect(filtrarEventos(evs, equipos, { estado: 'averiada' })).toHaveLength(1);
    expect(filtrarEventos(evs, equipos, { equipoId: 'b' })[0].motivo).toBe('sin frente');
    expect(filtrarEventos(evs, equipos, { desde: '2026-10-05' })).toHaveLength(1);
    expect(filtrarEventos(evs, equipos, { q: 'danó' })).toHaveLength(1);
  });
});

describe('lavados', () => {
  const lav = [
    { equipo_id: 'a', fecha: new Date(2026, 9, 1).toISOString(), tipo: 'Completo', responsable: 'Brigada Patio', nota: null, actor_name: null },
    { equipo_id: 'a', fecha: new Date(2026, 9, 8).toISOString(), tipo: 'Motor', responsable: 'José', nota: null, actor_name: null },
    { equipo_id: 'b', fecha: new Date(2026, 8, 20).toISOString(), tipo: 'Exterior', responsable: null, nota: 'tolva', actor_name: null },
  ];
  it('filtros por equipo, tipo, responsable, fechas y texto', () => {
    expect(filtrarLavados(lav, equipos, { equipoId: 'b' })).toHaveLength(1);
    expect(filtrarLavados(lav, equipos, { tipo: 'completo' })).toHaveLength(1);
    expect(filtrarLavados(lav, equipos, { responsable: 'brigada' })).toHaveLength(1);
    expect(filtrarLavados(lav, equipos, { desde: '2026-10-01', hasta: '2026-10-07' })).toHaveLength(1);
    expect(filtrarLavados(lav, equipos, { q: 'tolva' })).toHaveLength(1);
  });
  it('equipos sin lavar: nunca lavados primero, luego los de más días; sin retirados', () => {
    const hoy = new Date(2026, 9, 9);
    const r = equiposSinLavar([eq('a', 'A'), eq('b', 'B'), eq('c', 'C NUNCA'), eq('d', 'D RETIRADO', { activo: false })], lav, hoy);
    expect(r.map((x) => [x.equipo.equipo, x.dias])).toEqual([['C NUNCA', null], ['B', 19], ['A', 1]]);
  });
});

describe('repuestos y compras', () => {
  const base = { equipo_id: 'a', solicitud_salida_id: null, orden_compra_id: null, compras_notificada_at: null };
  const ordenes = [
    { ...base, id: '1', codigo: 'OS-1', estado: 'repuestos', created_at: '2026-10-02T10:00:00Z', repuestos: [{ producto_id: null, nombre: 'PIEZA X', unidad: 'und', cantidad: 2, desde_inventario: 0, a_comprar: 2 }] },
    { ...base, id: '2', codigo: 'OS-2', estado: 'realizada', created_at: '2026-10-01T10:00:00Z', repuestos: [{ producto_id: null, nombre: 'PIEZA Y', unidad: 'und', cantidad: 1, desde_inventario: 0, a_comprar: 1 }] },
    { ...base, id: '3', codigo: 'OS-3', estado: 'anulada', created_at: '2026-10-03T10:00:00Z', repuestos: [{ producto_id: 'p', nombre: 'FILTRO', unidad: 'und', cantidad: 1, desde_inventario: 1, a_comprar: 0 }] },
    { ...base, id: '4', codigo: 'OS-4', estado: 'abierta', created_at: '2026-10-04T10:00:00Z', repuestos: [] },
  ];
  it('piezas nuevas pendientes: solo de órdenes abiertas', () => {
    expect(piezasNuevasPendientes(ordenes).map((p) => p.pieza.nombre)).toEqual(['PIEZA X']);
  });
  it('órdenes con repuestos: sin anuladas ni órdenes sin repuestos', () => {
    expect(ordenesConRepuestos(ordenes).map((o) => o.id)).toEqual(['1', '2']);
  });
});

describe('acciones desde los submódulos', () => {
  it('retirados nunca; avería no se reporta dos veces', () => {
    expect(equipoAdmite('orden', 'retirada')).toBe(false);
    expect(equipoAdmite('lavado', 'taller')).toBe(true);
    expect(equipoAdmite('averia', 'averiada')).toBe(false);
    expect(equipoAdmite('averia', 'parada')).toBe(false);
    expect(equipoAdmite('averia', 'operativa')).toBe(true);
  });
});

describe('tableros de repuestos', () => {
  const o = (extra: Record<string, unknown>) => ({ id: '1', codigo: 'OS-1', equipo_id: 'a', estado: 'repuestos', created_at: '', solicitud_salida_id: null, orden_compra_id: null, compras_notificada_at: null,
    repuestos: [{ producto_id: 'p', nombre: 'X', unidad: 'und', cantidad: 4, desde_inventario: 2, a_comprar: 2 }], ...extra });
  it('salidas: por solicitar, según su estado o fuera del tablero', () => {
    expect(columnaSalidaDeOrden(o({}), null)).toBe('por_solicitar');
    expect(columnaSalidaDeOrden(o({ solicitud_salida_id: 's' }), 'ejecutada')).toBe('ejecutada');
    expect(columnaSalidaDeOrden(o({ solicitud_salida_id: 's' }), undefined)).toBe('por_aprobar');
    expect(columnaSalidaDeOrden(o({ repuestos: [{ producto_id: null, nombre: 'N', unidad: 'und', cantidad: 1, desde_inventario: 0, a_comprar: 1 }] }), null)).toBeNull();
  });
  it('compras: por solicitar o la columna de Pedidos', () => {
    expect(columnaCompraDeOrden(o({}), null)).toBe('por_solicitar');
    expect(columnaCompraDeOrden(o({ orden_compra_id: 'c' }), 'oc_aprobada')).toBe('ordenada');
    expect(columnaCompraDeOrden(o({ repuestos: [{ producto_id: 'p', nombre: 'X', unidad: 'und', cantidad: 1, desde_inventario: 1, a_comprar: 0 }] }), null)).toBeNull();
  });
});
