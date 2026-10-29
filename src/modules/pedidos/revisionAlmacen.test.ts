import { describe, expect, it } from 'vitest';
import type { ItemOrden } from '@/shared/lib/types';
import {
  marcarLote, marcasIniciales, mensajeRevisionAlmacen, mensajeSolicitudPedido, resumenRevision, todoRevisado,
} from './revisionAlmacen';

const items: ItemOrden[] = [
  { sku: 'INS-001', nombre: 'CEMENTO', cantidad: 10, precio: 0, unidad: 'SACO', productoId: 'p1' },
  { sku: 'GEN-AB-0', nombre: 'TORNILLO 1/2', cantidad: 50, precio: 0, unidad: 'und', general: true },
  { sku: 'INS-002', nombre: 'GUANTES', cantidad: 4, precio: 0, unidad: 'PAR', comprar: false },
];

describe('revisión de almacén', () => {
  it('las marcas iniciales salen sin revisar y omiten lo desmarcado en la SP', () => {
    const m = marcasIniciales(items);
    expect(Object.keys(m)).toEqual(['INS-001', 'GEN-AB-0']);
    expect(m['INS-001']).toEqual({ disponible: 0, revisado: false });
    expect(todoRevisado(items, m)).toBe(false);
  });

  it('por lote según stock: lo que alcance, nunca más de lo pedido', () => {
    const m = marcarLote(items, 'stock', new Map([['INS-001', 25], ['GEN-AB-0', 12]]));
    expect(m['INS-001'].disponible).toBe(10);
    expect(m['GEN-AB-0'].disponible).toBe(12);
    expect(todoRevisado(items, m)).toBe(true);
  });

  it('tiene / falta con las marcas en curso', () => {
    const m = { 'INS-001': { disponible: 10, revisado: true }, 'GEN-AB-0': { disponible: 12, revisado: true } };
    const r = resumenRevision(items, m);
    expect(r.tiene.map((x) => [x.nombre, x.cantidad])).toEqual([['CEMENTO', 10], ['TORNILLO 1/2', 12]]);
    expect(r.falta.map((x) => [x.nombre, x.cantidad])).toEqual([['TORNILLO 1/2', 38]]);
  });

  it('tiene / falta sobre la SP ya revisada por la base', () => {
    const revisada: ItemOrden[] = [
      { ...items[0], cantidad_solicitada: 10, cantidad_almacen: 10, cantidad: 0, comprar: false, almacen_revisado: true },
      { ...items[1], cantidad_solicitada: 50, cantidad_almacen: 12, cantidad: 38, comprar: true, almacen_revisado: true },
      items[2],
    ];
    const r = resumenRevision(revisada);
    expect(r.tiene.map((x) => x.cantidad)).toEqual([10, 12]);
    expect(r.falta.map((x) => [x.sku, x.cantidad])).toEqual([['GEN-AB-0', 38]]);
  });

  it('el mensaje de la revisión dice qué tiene y qué va a Compras', () => {
    const txt = mensajeRevisionAlmacen(
      { codigo: 'SP-2026-0300', items, revisada_almacen_en: '2026-10-29T15:00:00Z', nota_almacen: null },
      { marcas: { 'INS-001': { disponible: 10, revisado: true }, 'GEN-AB-0': { disponible: 0, revisado: true } }, revisor: 'ISNER' },
    );
    expect(txt).toContain('ALMACÉN HA REVISADO LA ORDEN SP-2026-0300');
    expect(txt).toContain('• CEMENTO — 10 SACO');
    expect(txt).toContain('VA A SOLICITAR A COMPRAS');
    expect(txt).toContain('• TORNILLO 1/2 — 50 und');
    expect(txt).not.toContain('GUANTES');
    expect(txt).not.toContain('️');
  });

  it('si almacén tiene todo, no va nada a Compras', () => {
    const txt = mensajeRevisionAlmacen(
      { codigo: 'SP-1', items: [items[0]], revisada_almacen_en: null, nota_almacen: 'Retirar en Los Pinos' },
      { marcas: { 'INS-001': { disponible: 10, revisado: true } } },
    );
    expect(txt).toContain('nada, almacén tiene todo');
    expect(txt).toContain('📝 Retirar en Los Pinos');
  });

  it('el mensaje de la SP lista lo solicitado con su cantidad', () => {
    const txt = mensajeSolicitudPedido(
      { codigo: 'SP-2026-0300', items, created_at: '2026-10-29T15:00:00Z', finalidad: 'Obra galpón', motivo: null, urgente: true, notas: null },
      { unidad: 'MANTENIMIENTO', persona: 'JOSÉ PÉREZ' },
    );
    expect(txt).toContain('SOLICITUD DE PEDIDO SP-2026-0300');
    expect(txt).toContain('URGENTE');
    expect(txt).toContain('Solicita: MANTENIMIENTO — JOSÉ PÉREZ');
    expect(txt).toContain('PRODUCTOS SOLICITADOS (2)');
    expect(txt).toContain('• TORNILLO 1/2 — 50 und');
    expect(txt).not.toContain('️');
  });
});
