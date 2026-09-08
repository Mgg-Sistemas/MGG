import { describe, it, expect } from 'vitest';
import { filasSolicitud, descripcionSolicitud } from './solicitudCotizacionPdf';
import type { Orden, ItemOrden } from '@/shared/lib/types';

const item = (p: Partial<ItemOrden>): ItemOrden => ({
  sku: 'X-1', nombre: 'MATERIAL', cantidad: 1, precio: 0, unidad: 'UNIDAD', comprar: true,
  ...p,
} as ItemOrden);

const orden = (items: ItemOrden[]) => ({ items } as Pick<Orden, 'items'>);

describe('renglones de la solicitud', () => {
  it('numera y trae SKU, material, medida y cantidad', () => {
    // Los tres primeros renglones reales de SP-2026-0131.
    const o = orden([
      item({ sku: 'MTO-002', nombre: 'NOTAS ADHESIVAS', unidad: 'PAQUETE', cantidad: 2 }),
      item({ sku: 'PAP-030', nombre: 'RESMA DE HOJA TIPO CARTA', unidad: 'CAJA', cantidad: 1 }),
    ]);
    expect(filasSolicitud(o)).toEqual([
      { n: '1', sku: 'MTO-002', nombre: 'NOTAS ADHESIVAS', medida: 'PAQUETE', cantidad: '2' },
      { n: '2', sku: 'PAP-030', nombre: 'RESMA DE HOJA TIPO CARTA', medida: 'CAJA', cantidad: '1' },
    ]);
  });

  it('deja afuera lo marcado como «no comprar» y vuelve a numerar', () => {
    const o = orden([
      item({ sku: 'A-1', comprar: false }),
      item({ sku: 'B-2', nombre: 'SI VA', unidad: 'CAJA', cantidad: 3 }),
    ]);
    expect(filasSolicitud(o).map((f) => [f.n, f.sku])).toEqual([['1', 'B-2']]);
  });

  it('un renglón sin la bandera comprar se cotiza igual', () => {
    // Las órdenes viejas no traen `comprar`; solo se excluye el false explícito.
    const o = orden([item({ sku: 'C-3', comprar: undefined })]);
    expect(filasSolicitud(o)).toHaveLength(1);
  });

  it('la cantidad no se rellena con decimales, pero respeta los que hay', () => {
    const o = orden([item({ cantidad: 2 }), item({ cantidad: 0.5 })]);
    expect(filasSolicitud(o).map((f) => f.cantidad)).toEqual(['2', '0,5']);
  });

  it('sin medida o sin SKU pone una raya, no un hueco', () => {
    // La base devuelve `unidad` en null en fichas viejas, aunque el tipo diga string.
    const o = { items: [{ sku: '', nombre: '', unidad: null, cantidad: 1, precio: 0 }] } as unknown as Pick<Orden, 'items'>;
    expect(filasSolicitud(o)[0]).toMatchObject({ sku: '—', medida: '—', nombre: '(sin nombre)' });
  });

  it('una orden sin ítems no rompe', () => {
    expect(filasSolicitud({ items: [] } as Pick<Orden, 'items'>)).toEqual([]);
    expect(filasSolicitud({ items: null } as unknown as Pick<Orden, 'items'>)).toEqual([]);
  });
});

describe('descripción de la solicitud', () => {
  const d = (motivo: unknown, finalidad: unknown) =>
    descripcionSolicitud({ motivo, finalidad } as Pick<Orden, 'motivo' | 'finalidad'>);

  it('junta motivo y finalidad cuando dicen cosas distintas', () => {
    expect(d('SE ROMPIO LA IMPRESORA', 'PARA EL AREA ADMINISTRATIVA'))
      .toBe('SE ROMPIO LA IMPRESORA\nPARA EL AREA ADMINISTRATIVA');
  });

  it('no repite el mismo texto dos veces', () => {
    // Pasa en muchas órdenes: los dos campos traen lo mismo.
    expect(d('MATERIALES DE OFICINA', 'materiales de oficina')).toBe('MATERIALES DE OFICINA');
  });

  it('funciona con uno solo de los dos', () => {
    expect(d('SOLO MOTIVO', '')).toBe('SOLO MOTIVO');
    expect(d(null, 'SOLO FINALIDAD')).toBe('SOLO FINALIDAD');
    expect(d(null, null)).toBe('');
  });
});
