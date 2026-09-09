import { describe, it, expect } from 'vitest';
import { ordenDeOfertas, esSubOrden, avisoProveedoresOcultos } from './ordenDeOfertas';

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
