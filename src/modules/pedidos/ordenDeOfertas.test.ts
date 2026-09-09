import { describe, it, expect } from 'vitest';
import { ordenDeOfertas, esSubOrden, avisoProveedoresOcultos, ordenesConOfertasDe, unificarPorProveedor } from './ordenDeOfertas';

const prov = (id: string, razon_social: string, estado = 'activo') => ({ id, razon_social, estado });

describe('ordenDeOfertas', () => {
  it('una orden normal guarda sus ofertas en sí misma', () => {
    expect(ordenDeOfertas({ id: 'op-1', parent_orden_id: null })).toBe('op-1');
  });

  it('una sub-OC las guarda en su orden madre', () => {
    expect(ordenDeOfertas({ id: 'hija-1', parent_orden_id: 'madre-1' })).toBe('madre-1');
  });

  it('sin la columna (orden vieja) cae en la orden propia', () => {
    expect(ordenDeOfertas({ id: 'op-2' })).toBe('op-2');
  });

  it('trata el string vacío como «sin padre», no como un id', () => {
    expect(ordenDeOfertas({ id: 'op-3', parent_orden_id: '' })).toBe('op-3');
  });

  it('sube UN nivel: una sub-sub-orden va a su padre directo, no a la raíz', () => {
    // SP-2026-0098-1-1 → SP-2026-0098-1 (no hasta SP-2026-0098).
    expect(ordenDeOfertas({ id: 'nieta', parent_orden_id: 'hija' })).toBe('hija');
  });

  it('el caso real: guardar y leer resuelven la MISMA orden', () => {
    // Era el bug: la comparativa leía del padre y crearOferta escribía en la hija.
    const hija = { id: '526e2216', parent_orden_id: 'd75fb298' };
    const dondeSeGuarda = ordenDeOfertas(hija);
    const dondeSeLee = ordenDeOfertas(hija);
    expect(dondeSeGuarda).toBe(dondeSeLee);
    expect(dondeSeGuarda).toBe('d75fb298');
  });

  it('esSubOrden distingue una hija de una orden raíz', () => {
    expect(esSubOrden({ id: 'a', parent_orden_id: 'b' })).toBe(true);
    expect(esSubOrden({ id: 'a', parent_orden_id: null })).toBe(false);
    expect(esSubOrden({ id: 'a' })).toBe(false);
  });
});

describe('avisoProveedoresOcultos', () => {
  const proveedores = [
    prov('p1', 'IKIGAI, C.A.501'),
    prov('p2', 'STIKERS XPRESS'),
    prov('p3', 'FILTROS NEKUIMA, C.A.'),
    prov('p4', 'AUTOPARTES TODO CLUTCH,C.A.'),
    prov('p5', 'ACEROMASTER, C.A.'),
  ];

  it('sin exclusiones no dice nada', () => {
    expect(avisoProveedoresOcultos(proveedores, new Set())).toBeNull();
  });

  it('nombra al proveedor escondido y dice cómo corregirlo', () => {
    const msg = avisoProveedoresOcultos(proveedores, new Set(['p1']));
    expect(msg).toContain('IKIGAI, C.A.501');
    expect(msg).toContain('ya cargó una oferta');
    expect(msg).toContain('✎');
  });

  it('con varios usa el plural', () => {
    const msg = avisoProveedoresOcultos(proveedores, new Set(['p1', 'p3']));
    expect(msg).toContain('ya cargaron su oferta');
  });

  it('ordena los nombres alfabéticamente', () => {
    const msg = avisoProveedoresOcultos(proveedores, new Set(['p1', 'p3'])) ?? '';
    expect(msg.indexOf('FILTROS NEKUIMA')).toBeLessThan(msg.indexOf('IKIGAI'));
  });

  it('resume con «y N más» cuando pasan de tres', () => {
    const msg = avisoProveedoresOcultos(proveedores, new Set(['p1', 'p2', 'p3', 'p4', 'p5'])) ?? '';
    expect(msg).toContain('y 2 más');
  });

  it('ignora a los inactivos: tampoco estaban en el selector', () => {
    const conInactivo = [...proveedores, prov('p6', 'PROVEEDOR VIEJO', 'inactivo')];
    const msg = avisoProveedoresOcultos(conInactivo, new Set(['p6']));
    expect(msg).toBeNull();
  });

  it('un id excluido que ya no está en la lista no genera aviso vacío', () => {
    expect(avisoProveedoresOcultos(proveedores, new Set(['borrado']))).toBeNull();
  });
});

describe('ordenesConOfertasDe', () => {
  it('una orden normal se mira a sí misma, una sola vez', () => {
    expect(ordenesConOfertasDe({ id: 'op-1', parent_orden_id: null })).toEqual(['op-1']);
  });

  it('una sub-OC mira la madre Y a sí misma (ahí quedaron las ofertas viejas)', () => {
    expect(ordenesConOfertasDe({ id: 'hija', parent_orden_id: 'madre' })).toEqual(['madre', 'hija']);
  });

  it('la canónica va primero: es donde el sistema escribe hoy', () => {
    const [primera] = ordenesConOfertasDe({ id: 'hija', parent_orden_id: 'madre' });
    expect(primera).toBe(ordenDeOfertas({ id: 'hija', parent_orden_id: 'madre' }));
  });

  it('no duplica cuando el padre viene vacío', () => {
    expect(ordenesConOfertasDe({ id: 'op-2', parent_orden_id: '' })).toEqual(['op-2']);
  });

  it('el caso real: SP-2026-0098-1-1 mira su madre y su propia fila', () => {
    // Ahí están las 2 ofertas que se guardaron cuando leer y escribir discrepaban.
    expect(ordenesConOfertasDe({ id: '526e2216', parent_orden_id: 'd75fb298' }))
      .toEqual(['d75fb298', '526e2216']);
  });
});

describe('unificarPorProveedor', () => {
  const of = (id: string, proveedor_id: string, orden_id: string) => ({ id, proveedor_id, orden_id });

  it('deja pasar ofertas de proveedores distintos', () => {
    const rows = [of('a', 'p1', 'madre'), of('b', 'p2', 'madre')];
    expect(unificarPorProveedor(rows, 'madre')).toHaveLength(2);
  });

  it('con el mismo proveedor en madre e hija, gana la de la madre', () => {
    const rows = [of('vieja', 'p1', 'hija'), of('nueva', 'p1', 'madre')];
    const out = unificarPorProveedor(rows, 'madre');
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('nueva');
  });

  it('no importa el orden en que lleguen', () => {
    const rows = [of('nueva', 'p1', 'madre'), of('vieja', 'p1', 'hija')];
    expect(unificarPorProveedor(rows, 'madre')[0].id).toBe('nueva');
  });

  it('si solo existe la de la hija, esa se muestra (es la que hay)', () => {
    const rows = [of('huerfana', 'p1', 'hija')];
    const out = unificarPorProveedor(rows, 'madre');
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('huerfana');
  });

  it('conserva el orden por precio con el que vienen', () => {
    const rows = [of('barata', 'p1', 'madre'), of('media', 'p2', 'hija'), of('cara', 'p3', 'madre')];
    expect(unificarPorProveedor(rows, 'madre').map((o) => o.id)).toEqual(['barata', 'media', 'cara']);
  });

  it('el caso real de SP-2026-0098-1-1: dos proveedores distintos, no se pierde ninguno', () => {
    const rows = [of('o1', 'servicios-ing', 'hija'), of('o2', 'ikigai', 'hija'), of('o3', 'florida', 'madre')];
    expect(unificarPorProveedor(rows, 'madre')).toHaveLength(3);
  });
});
