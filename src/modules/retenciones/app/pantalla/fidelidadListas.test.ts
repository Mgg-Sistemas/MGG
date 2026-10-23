import { describe, expect, it } from 'vitest';
import type { RetencionPracticada } from '../datos/puerta';
import { FILTRO_INICIAL, facturasRealizadas, filasLibro, opcionesRealizadas } from './realizadasYLibro';
import { directoPorNumero } from './numeroDirecto';

// Datos inventados.
let n = 0;
const r = (over: Partial<RetencionPracticada>): RetencionPracticada => ({
  id: `r${++n}`, tipo: 'iva', direccion: 'practicada', estado: 'registrada', docKind: 'oc', docId: `oc-${n}`, docCodigo: 'OC-0001',
  contraparteNombre: 'Proveedor Alfa', contraparteRif: 'J-00000001-0', facturaNumero: `F${n}`, facturaFecha: '2026-10-03',
  numeroComprobante: '20261000000011', anulada: false, createdAt: '2026-10-03T15:28:00', ...over,
}) as RetencionPracticada;

describe('el orden «Proveedor (A–Z)» de Realizadas y del Libro (maqueta v8-3-listas.js:207 y :257)', () => {
  const xs = [r({ contraparteNombre: 'Zeta', facturaFecha: '2026-10-01' }), r({ contraparteNombre: 'Alfa', facturaFecha: '2026-10-01' }), r({ contraparteNombre: 'Alfa', facturaFecha: '2026-10-09' })];
  it('por nombre y, dentro de cada proveedor, el más reciente primero', () => {
    expect(filasLibro(xs, { ...FILTRO_INICIAL, orden: 'proveedor' }).map((x) => [x.contraparteNombre, x.facturaFecha]))
      .toEqual([['Alfa', '2026-10-09'], ['Alfa', '2026-10-01'], ['Zeta', '2026-10-01']]);
    expect(facturasRealizadas(xs, { ...FILTRO_INICIAL, orden: 'proveedor' }).map((x) => [x.contraparteNombre, x.fecha]))
      .toEqual([['Alfa', '2026-10-09'], ['Alfa', '2026-10-01'], ['Zeta', '2026-10-01']]);
  });
});

describe('el salto directo a un N° de comprobante (maqueta v8Directo, v8-3-listas.js:234)', () => {
  const xs = [r({ numeroComprobante: '20261000000011' }), r({ numeroComprobante: '20261000000022', tipo: 'islr' }), r({ numeroComprobante: '20261000000022', tipo: 'iva', direccion: 'recibida', contraparteNombre: 'Cliente Uno' })];
  it('solo con un número completo, de 8 a 14 cifras', () => {
    expect(directoPorNumero('2026', xs)).toBeNull();
    expect(directoPorNumero('Alfa', xs)).toBeNull();
  });
  it('uno: con su impuesto, proveedor y estado', () => {
    expect(directoPorNumero(' 20261000000011 ', xs)).toMatchObject({ tipo: 'uno', numero: '20261000000011', texto: 'IVA · Proveedor Alfa · registrada' });
  });
  it('varios: el mismo número en series distintas', () => {
    const d = directoPorNumero('20261000000022', xs);
    expect(d?.tipo).toBe('varios');
    expect(d && d.tipo === 'varios' && d.opciones.map((o) => o.texto)).toEqual(['ISLR · Proveedor Alfa · registrada', 'IVA de un cliente · Cliente Uno · registrada']);
    expect(d && d.tipo === 'varios' && d.series).toBe('ISLR · IVA de un cliente');
  });
  it('ninguno', () => {
    expect(directoPorNumero('99999999', xs)).toEqual({ tipo: 'ninguno', numero: '99999999' });
  });
});

describe('las anuladas con número en Realizadas (maqueta v8-3-listas.js:219)', () => {
  it('las anuladas con comprobante tienen número y estado anulada', () => {
    const anulada = r({ numeroComprobante: '20261000000033', anulada: true });
    expect(anulada.numeroComprobante).toBe('20261000000033');
    expect(anulada.anulada).toBe(true);
  });
});

describe('el filtro Estado de Realizadas con 4 opciones (maqueta v8-3-listas.js:174)', () => {
  const xs = [
    r({ id: 'r1', docId: 'fac-1', facturaNumero: '100', estado: 'registrada', anulada: false }),
    r({ id: 'r2', docId: 'fac-2', facturaNumero: '200', estado: 'declarada', anulada: false }),
    r({ id: 'r3', docId: 'fac-3', facturaNumero: '300', tipo: 'iva', estado: 'registrada', anulada: true }),
    r({ id: 'r4', docId: 'fac-4', facturaNumero: '400', tipo: 'iva', estado: 'registrada', anulada: true }),
    r({ id: 'r5', docId: 'fac-4', facturaNumero: '400', tipo: 'iva', estado: 'registrada', anulada: false }),
  ];

  it('cuenta las 4 opciones de estado a nivel de factura', () => {
    const opc = opcionesRealizadas(xs);
    const estados = opc.estado.map((e) => [e.valor, e.texto, e.cuenta]);
    expect(estados).toEqual([
      ['registrada', 'Registrada', 2],
      ['declarada', 'Declarada', 1],
      ['anulada_pend', 'Anulada · pendiente de registrar de nuevo', 1],
      ['reemplazada', 'Anulada · reemplazada', 1],
    ]);
  });

  it('filtra facturas por anulada_pend y por reemplazada', () => {
    const pend = facturasRealizadas(xs, { ...FILTRO_INICIAL, estado: 'anulada_pend' });
    expect(pend.map((f) => f.facturaNumero)).toEqual(['300']);
    const reemp = facturasRealizadas(xs, { ...FILTRO_INICIAL, estado: 'reemplazada' });
    expect(reemp.map((f) => f.facturaNumero)).toEqual(['400']);
  });
});

