import { describe, it, expect } from 'vitest';
import {
  separarEquivalencias, coincideRepuesto, agruparPorSistema, estadoStock, filasParaCopiar, marcadoParaOrden,
  lineasDesdeFicha, necesidadesProximoServicio, equiposPorServicio, textoCada, nombrePiezaNueva,
  type RepuestoEquipo, type ProductoRepuesto,
} from './repuestosEquipo';

const r = (o: Partial<RepuestoEquipo>): RepuestoEquipo => ({
  id: o.id ?? Math.random().toString(36).slice(2), equipo_id: 'e1', sistema: 'motor', tipo: 'Filtro de aceite', numero_parte: null,
  equivalencias: [], especificacion: null, cantidad: 1, unidad: 'und', cada_hrs: null, cada_km: null, en_servicio: true,
  producto_id: null, nota: null, orden: 0, created_by: null, created_at: '', updated_by: null, updated_at: '', ...o,
});
const prod = (id: string, stock: number, nombre = id): ProductoRepuesto => ({ id, nombre, unidad: 'und', stock });

describe('ficha de repuestos del equipo', () => {
  it('separa las equivalencias por renglón, coma o punto y coma, sin repetir y en mayúsculas', () => {
    expect(separarEquivalencias('donaldson p553771\nFleetguard LF3413; DONALDSON  P553771, baldwin b236'))
      .toEqual(['DONALDSON P553771', 'FLEETGUARD LF3413', 'BALDWIN B236']);
    // «/» y «-» no parten: muchos números de parte los llevan.
    expect(separarEquivalencias('1030-61460/EC210')).toEqual(['1030-61460/EC210']);
  });

  it('encuentra por número de parte aunque se escriba con guiones o espacios, y por equivalencia', () => {
    const x = r({ numero_parte: '17457469', equivalencias: ['DONALDSON P553771'], especificacion: '15W-40' });
    expect(coincideRepuesto(x, '1745-7469')).toBe(true);
    expect(coincideRepuesto(x, 'p553771')).toBe(true);
    expect(coincideRepuesto(x, '15w40')).toBe(true);
    expect(coincideRepuesto(x, 'filtro aceite')).toBe(true);
    expect(coincideRepuesto(x, 'caucho')).toBe(false);
    expect(coincideRepuesto(x, 'ec210', ['VOLVO EC210'])).toBe(true);
  });

  it('agrupa por sistema en el orden de la lista', () => {
    const g = agruparPorSistema([r({ sistema: 'cauchos', tipo: 'Caucho' }), r({ sistema: 'motor', tipo: 'B' }), r({ sistema: 'motor', tipo: 'A' })]);
    expect(g.map((x) => x.sistema.id)).toEqual(['motor', 'cauchos']);
    expect(g[0].items.map((x) => x.tipo)).toEqual(['A', 'B']);
  });

  it('dice si alcanza el inventario', () => {
    expect(estadoStock(2, null)).toBe('sin_producto');
    expect(estadoStock(2, { stock: 0 })).toBe('no_hay');
    expect(estadoStock(2, { stock: 1 })).toBe('poco');
    expect(estadoStock(2, { stock: 2 })).toBe('hay');
  });

  it('al copiar no repite lo que el destino ya tiene', () => {
    const origen = [r({ tipo: 'Filtro de aceite', numero_parte: '17457469' }), r({ sistema: 'aire', tipo: 'Filtro de aire primario', numero_parte: '11110022' })];
    const destino = [r({ tipo: 'FILTRO DE ACEITE', numero_parte: '1745 7469' })];
    const f = filasParaCopiar(origen, destino);
    expect(f).toHaveLength(1);
    expect(f[0].tipo).toBe('Filtro de aire primario');
  });

  it('marca solo lo que corresponde al tipo de orden', () => {
    const aceite = r({ sistema: 'motor', en_servicio: true });
    const caucho = r({ sistema: 'cauchos', en_servicio: false });
    expect(marcadoParaOrden(aceite, 'preventivo')).toBe(true);
    expect(marcadoParaOrden(caucho, 'preventivo')).toBe(false);
    expect(marcadoParaOrden(caucho, 'cauchos')).toBe(true);
    expect(marcadoParaOrden(aceite, 'reparacion')).toBe(false);
  });

  it('pasa la ficha a líneas de la orden: enlazadas con su stock y las demás como pieza nueva', () => {
    const ps = new Map([['p1', { ...prod('p1', 3, 'FILTRO P553771'), almacen: 'General' }]]);
    const ls = lineasDesdeFicha([
      r({ producto_id: 'p1', cantidad: 2 }), r({ producto_id: 'p1', cantidad: 1, sistema: 'aire' }),
      r({ tipo: 'Filtro separador', numero_parte: 'fs1287', cantidad: 1 }),
    ], ps);
    expect(ls).toEqual([
      { productoId: 'p1', nombre: 'FILTRO P553771', unidad: 'und', cantidad: 3, stock: 3, almacen: 'General' },
      { productoId: null, nombre: 'FILTRO SEPARADOR FS1287', unidad: 'und', cantidad: 1, stock: 0, almacen: null },
    ]);
    expect(nombrePiezaNueva(r({ tipo: 'Aceite de motor', especificacion: '15W-40' }))).toBe('ACEITE DE MOTOR 15W-40');
  });

  it('suma lo que piden las fichas de los equipos por servicio contra el stock', () => {
    const aviso = (nivel: 'ok' | 'proximo' | 'vencido', ratio: number) => ({ nivel, restante: 10, unidad: 'h' as const, pct: 90, ratio });
    const eqs = equiposPorServicio([
      { id: 'e1', equipo: 'EC210', aviso: aviso('vencido', 1.1) },
      { id: 'e2', equipo: 'EC240', aviso: aviso('proximo', .95) },
      { id: 'e3', equipo: 'L220G', aviso: aviso('ok', .2) },
    ]);
    expect(eqs.map((e) => e.equipo)).toEqual(['EC210', 'EC240']);
    const ps = new Map([['p1', prod('p1', 3)], ['p2', prod('p2', 10)]]);
    const n = necesidadesProximoServicio(eqs, [
      r({ equipo_id: 'e1', producto_id: 'p1', cantidad: 2 }),
      r({ equipo_id: 'e2', producto_id: 'p1', cantidad: 2 }),
      r({ equipo_id: 'e2', producto_id: 'p2', cantidad: 1 }),
      r({ equipo_id: 'e2', sistema: 'cauchos', producto_id: 'p2', cantidad: 4, en_servicio: false }),
      r({ equipo_id: 'e3', producto_id: 'p1', cantidad: 5 }),
      r({ equipo_id: 'e1', tipo: 'Filtro racor' }),
    ], ps);
    expect(n.porProducto.map((x) => [x.producto.id, x.cantidad, x.faltante, x.equipos])).toEqual([
      ['p1', 4, 1, ['EC210', 'EC240']],
      ['p2', 1, 0, ['EC240']],
    ]);
    expect(n.sinProducto.map((x) => [x.equipo, x.renglon.tipo])).toEqual([['EC210', 'Filtro racor']]);
  });

  it('escribe cada cuánto se cambia', () => {
    expect(textoCada({ cada_hrs: 250, cada_km: null })).toBe('250 h');
    expect(textoCada({ cada_hrs: null, cada_km: null })).toBe('');
  });
});
