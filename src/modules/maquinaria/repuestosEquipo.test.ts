import { describe, it, expect } from 'vitest';
import {
  SISTEMAS, sistemaDe, validarRepuestoEquipo, nombreRepuesto, detalleRepuesto, textoCada, duplicadoEnFicha, agruparPorSistema,
  estadoStock, proximoServicioNominal, tocaEnServicio, buscarCompatibles, faltantesProximoServicio, repuestosParaCopiar,
  type RepuestoEquipo,
} from './repuestosEquipo';

const base = (x: Partial<RepuestoEquipo>): RepuestoEquipo => ({
  id: 'r1', equipo_id: 'e1', sistema: 'motor', tipo: 'Filtro de aceite', numero_parte: '17457469', equivalencias: 'Donaldson P553771 · Fleetguard LF3413',
  especificacion: null, cantidad: 1, unidad: 'und', cada_horas: null, cada_km: null, producto_id: null, nota: null, orden: 0,
  actor: null, actor_name: null, created_at: '2026-10-14T10:00:00Z', updated_at: null, ...x,
});

describe('sistemas y validación', () => {
  it('todo sistema tiene etiqueta e icono; uno desconocido cae en Otros', () => {
    expect(SISTEMAS.every((s) => s.label && s.icon)).toBe(true);
    expect(sistemaDe('motor').label).toBe('Motor');
    expect(sistemaDe('lo-que-sea').id).toBe('otros');
  });
  it('exige sistema, tipo, cantidad y al menos un dato para comprar', () => {
    expect(validarRepuestoEquipo({ sistema: 'motor', tipo: 'Filtro', cantidad: 1, numero_parte: 'X1' })).toBeNull();
    expect(validarRepuestoEquipo({ sistema: 'nada', tipo: 'Filtro', cantidad: 1, numero_parte: 'X1' })).toMatch(/sistema/);
    expect(validarRepuestoEquipo({ sistema: 'motor', tipo: 'F', cantidad: 1, numero_parte: 'X1' })).toMatch(/qué es/);
    expect(validarRepuestoEquipo({ sistema: 'motor', tipo: 'Filtro', cantidad: 0, numero_parte: 'X1' })).toMatch(/cantidad/);
    expect(validarRepuestoEquipo({ sistema: 'motor', tipo: 'Filtro', cantidad: 1 })).toMatch(/número de parte/);
    expect(validarRepuestoEquipo({ sistema: 'motor', tipo: 'Aceite', cantidad: 28, especificacion: '15W-40' })).toBeNull();
    expect(validarRepuestoEquipo({ sistema: 'motor', tipo: 'Aceite', cantidad: 28, producto_id: 'p1' })).toBeNull();
    expect(validarRepuestoEquipo({ sistema: 'motor', tipo: 'Aceite', cantidad: 1, producto_id: 'p1', cada_horas: 0 })).toMatch(/horas/);
  });
});

describe('nombre, detalle y texto', () => {
  it('nombre = tipo + número de parte (o especificación), en mayúsculas', () => {
    expect(nombreRepuesto(base({}))).toBe('FILTRO DE ACEITE 17457469');
    expect(nombreRepuesto(base({ tipo: 'Aceite de motor', numero_parte: null, especificacion: '15W-40' }))).toBe('ACEITE DE MOTOR 15W-40');
    expect(nombreRepuesto(base({ tipo: ' Caucho ', numero_parte: '  ', especificacion: null }))).toBe('CAUCHO');
  });
  it('detalle junta número, equivalencias y especificación', () => {
    expect(detalleRepuesto(base({ especificacion: 'Rosca 1"' }))).toBe('17457469 · Donaldson P553771 · Fleetguard LF3413 · Rosca 1"');
    expect(detalleRepuesto(base({ numero_parte: null, equivalencias: null, especificacion: null }))).toBe('');
  });
  it('cada cuánto', () => {
    expect(textoCada(base({}))).toBe('en todos los servicios');
    expect(textoCada(base({ cada_horas: 500 }))).toBe('cada 500 h');
    expect(textoCada(base({ cada_horas: 500, cada_km: 10000 }), (n) => n.toLocaleString('de-DE'))).toBe('cada 500 h / cada 10.000 km');
  });
  it('detecta el duplicado en la ficha (sin distinguir mayúsculas ni acentos) y se excluye a sí mismo al editar', () => {
    const lista = [base({ id: 'a' })];
    expect(duplicadoEnFicha(lista, { tipo: 'filtro de aceite', numero_parte: '17457469', especificacion: null })).toBe(true);
    expect(duplicadoEnFicha(lista, { tipo: 'filtro de aceite', numero_parte: '17457469', especificacion: null }, 'a')).toBe(false);
    expect(duplicadoEnFicha(lista, { tipo: 'Filtro de aceite', numero_parte: 'OTRO', especificacion: null })).toBe(false);
  });
});

describe('agrupado y stock', () => {
  it('agrupa por sistema en el orden de la lista y ordena dentro por orden y tipo', () => {
    const g = agruparPorSistema([
      base({ id: '1', sistema: 'cauchos', tipo: 'Caucho trasero', orden: 2 }),
      base({ id: '2', sistema: 'motor', tipo: 'Aceite de motor' }),
      base({ id: '3', sistema: 'cauchos', tipo: 'Caucho delantero', orden: 1 }),
      base({ id: '4', sistema: 'raro' }),
    ]);
    expect(g.map((x) => x.sistema.id)).toEqual(['motor', 'cauchos', 'otros']);
    expect(g[1].items.map((i) => i.id)).toEqual(['3', '1']);
  });
  it('stock: hay / no hay / sin producto', () => {
    expect(estadoStock(base({ producto_id: 'p', cantidad: 2 }), { stock: 5 })).toEqual({ estado: 'hay', stock: 5 });
    expect(estadoStock(base({ producto_id: 'p', cantidad: 2 }), { stock: 1 })).toEqual({ estado: 'no_hay', stock: 1 });
    expect(estadoStock(base({ producto_id: 'p', cantidad: 2 }), { stock: -3 })).toEqual({ estado: 'no_hay', stock: 0 });
    expect(estadoStock(base({ producto_id: null }), null)).toEqual({ estado: 'sin_producto', stock: null });
    expect(estadoStock(base({ producto_id: 'p' }), undefined).estado).toBe('sin_producto');
  });
});

describe('próximo servicio y «toca»', () => {
  it('próximo nominal: múltiplo del intervalo que sigue a la lectura o a la base', () => {
    expect(proximoServicioNominal(250, 490, null)).toBe(500);
    expect(proximoServicioNominal(250, 500, null)).toBe(500);
    expect(proximoServicioNominal(250, 0, null)).toBe(250);
    expect(proximoServicioNominal(250, 740, 260)).toBe(500);
    expect(proximoServicioNominal(250, 740, 510)).toBe(750);
    expect(proximoServicioNominal(null, 740, null)).toBeNull();
    expect(proximoServicioNominal(250, null, null)).toBeNull();
  });
  it('sin «cada cuánto» toca siempre; con cada 500 h toca en el servicio de 500 y 1000, no en el de 750', () => {
    expect(tocaEnServicio(base({}), { horas: 750, km: null })).toBe(true);
    expect(tocaEnServicio(base({ cada_horas: 500 }), { horas: 500, km: null })).toBe(true);
    expect(tocaEnServicio(base({ cada_horas: 500 }), { horas: 1000, km: null })).toBe(true);
    expect(tocaEnServicio(base({ cada_horas: 500 }), { horas: 750, km: null })).toBe(false);
    expect(tocaEnServicio(base({ cada_horas: 500 }), { horas: null, km: null })).toBe(true);
    expect(tocaEnServicio(base({ cada_km: 10000 }), { horas: 750, km: 20000 })).toBe(true);
    expect(tocaEnServicio(base({ cada_km: 10000 }), { horas: 750, km: 15000 })).toBe(false);
    expect(tocaEnServicio(base({ cada_horas: 500, cada_km: 10000 }), { horas: 750, km: 20000 })).toBe(true);
  });
});

describe('buscador y qué comprar', () => {
  const productos = new Map([
    ['p1', { nombre: 'FILTRO ACEITE LF3413', sku: 'REP-001', stock: 1, unidad: 'und' }],
    ['p2', { nombre: 'ACEITE 15W-40', sku: 'LUB-002', stock: 100, unidad: 'L' }],
  ]);
  const fichas = [
    base({ id: 'a', equipo_id: 'e1', producto_id: 'p1' }),
    base({ id: 'b', equipo_id: 'e2', producto_id: 'p1', tipo: 'Filtro de aceite', numero_parte: '17457469' }),
    base({ id: 'c', equipo_id: 'e1', sistema: 'motor', tipo: 'Aceite de motor', numero_parte: null, equivalencias: null, especificacion: '15W-40', cantidad: 28, unidad: 'L', producto_id: 'p2' }),
    base({ id: 'd', equipo_id: 'e2', sistema: 'cauchos', tipo: 'Caucho', numero_parte: null, equivalencias: 'Bridgestone', especificacion: '23.5R25', cantidad: 4, cada_horas: 2000 }),
    base({ id: 'e', equipo_id: 'e1', sistema: 'combustible', tipo: 'Filtro de combustible', numero_parte: 'FF5485', equivalencias: null, cada_horas: 500 }),
  ];
  it('busca por número original, equivalencia, especificación o nombre del producto', () => {
    expect(buscarCompatibles(fichas, 'P553771', productos).map((r) => r.id)).toEqual(['a', 'b']);
    expect(buscarCompatibles(fichas, 'lf3413', productos).map((r) => r.id)).toEqual(['a', 'b']);
    expect(buscarCompatibles(fichas, '23.5r25', productos).map((r) => r.id)).toEqual(['d']);
    expect(buscarCompatibles(fichas, 'aceite 15w', productos).map((r) => r.id)).toEqual(['c']);
    expect(buscarCompatibles(fichas, '', productos)).toEqual([]);
  });
  it('suma lo que toca a los equipos próximos, resta el stock y deja el faltante', () => {
    const res = faltantesProximoServicio(
      [{ id: 'e1', equipo: 'BOBCAT', proximoH: 750, proximoK: null }, { id: 'e2', equipo: 'IVECO', proximoH: 1000, proximoK: null }],
      fichas, productos,
    );
    const porClave = Object.fromEntries(res.map((n) => [n.clave, n]));
    // Filtro de aceite: 1 + 1 = 2, hay 1 → falta 1 (dos equipos).
    expect(porClave.p1.necesario).toBe(2);
    expect(porClave.p1.faltante).toBe(1);
    expect(porClave.p1.equipos.map((e) => e.equipo)).toEqual(['BOBCAT', 'IVECO']);
    // Aceite: 28 L con 100 L en stock → no falta.
    expect(porClave.p2.faltante).toBe(0);
    // Caucho cada 2000 h: el IVECO va al servicio de 1000 → no toca; no aparece.
    expect(res.some((n) => n.nombre.startsWith('CAUCHO'))).toBe(false);
    // Filtro de combustible cada 500 h: el BOBCAT va al de 750 → no toca.
    expect(res.some((n) => n.nombre.startsWith('FILTRO DE COMBUSTIBLE'))).toBe(false);
    // Orden: el que más falta primero.
    expect(res[0].clave).toBe('p1');
  });
  it('las piezas sin producto se agrupan por nombre y todo lo necesario es faltante', () => {
    const res = faltantesProximoServicio([{ id: 'e2', equipo: 'IVECO', proximoH: 2000, proximoK: null }], fichas, productos);
    const caucho = res.find((n) => n.nombre === 'CAUCHO 23.5R25');
    expect(caucho).toBeTruthy();
    expect(caucho?.stock).toBeNull();
    expect(caucho?.faltante).toBe(4);
    expect(caucho?.detalle).toBe('Bridgestone · 23.5R25');
  });
  it('copiar trae solo lo que el destino no tiene', () => {
    const destino = [base({ id: 'z', equipo_id: 'e9' })];
    expect(repuestosParaCopiar(fichas.filter((f) => f.equipo_id === 'e1'), destino).map((r) => r.id)).toEqual(['c', 'e']);
  });
});
