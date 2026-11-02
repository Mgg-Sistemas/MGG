import { describe, expect, it } from 'vitest';
import type { ItemOrden, Orden } from '@/shared/lib/types';
import {
  fichaSolicitudPedido, filasRepartoSp, filasSedesSp, filasTrasladosSp, renglonEnPdf, tablaProductosSp, tieneRevision,
} from './solicitudPedidoPdf';
import type { ItemRevision, OrdenRevision } from './revisionAlmacen';

const LP = 'LOS PINOS';
const MT = 'CENTRO DE FUNDICION - MATANZAS';

const items: ItemOrden[] = [
  { sku: 'INS-001', nombre: 'CEMENTO', cantidad: 10, precio: 0, unidad: 'SACO', productoId: 'p1' },
  { sku: 'GEN-AB-0', nombre: 'TORNILLO 1/2', cantidad: 50, precio: 0, unidad: 'und', general: true },
  { sku: 'INS-002', nombre: 'GUANTES', cantidad: 4, precio: 0, unidad: 'PAR', comprar: false },
];

const orden = (its: ItemOrden[], extra: Partial<OrdenRevision> = {}): Orden => ({
  id: 'o1', codigo: 'SP-2026-0300', estado: 'revision_almacen', created_at: '2026-11-01T14:00:00Z',
  solicitante: 'MANTENIMIENTO', ci_solicitante: 'JOSE PEREZ', items: its,
  revision_sedes: null, revisada_almacen_en: null, nota_almacen: null,
  ...extra,
} as unknown as Orden);

const nombre = (correo: string) => ({ 'isner@mgg.com': 'Isner', 'carlos@mgg.com': 'Carlos' }[correo] ?? '');

describe('PDF de la Solicitud de Pedido', () => {
  it('sin revisión: solo #, producto, cantidad y unidad; lo desmarcado en la SP no sale', () => {
    const o = orden(items);
    expect(tieneRevision(o)).toBe(false);
    expect(tablaProductosSp(o)).toEqual({
      head: ['#', 'Producto', 'Cantidad', 'Unidad'],
      body: [['1', 'CEMENTO', '10', 'SACO'], ['2', 'TORNILLO 1/2', '50', 'und']],
    });
  });

  it('la ficha junta unidad y persona, sede, finalidad y urgente', () => {
    const o = orden(items, { sede_destino: MT, finalidad: 'OBRA', urgente: true });
    const ficha = Object.fromEntries(fichaSolicitudPedido(o));
    expect(ficha['Solicitante']).toBe('MANTENIMIENTO — JOSE PEREZ');
    expect(ficha['Se necesita en']).toBe('Matanza');
    expect(ficha['Finalidad']).toBe('OBRA');
    expect(ficha['Urgente']).toBe('Sí');
    expect(ficha['Estado']).toBe('En revisión de almacén');
    expect(ficha['Notas']).toBeUndefined();
  });

  it('en curso: lo que respondió cada sede; A Compras solo cuando respondieron todas', () => {
    const its: ItemRevision[] = [
      { ...items[0], almacen_sedes: { [LP]: { disponible: 4, revisado: true }, [MT]: { disponible: 3, revisado: true } } },
      { ...items[1], almacen_sedes: { [LP]: { disponible: 0, revisado: true } } },
      items[2],
    ];
    const o = orden(its, { revision_sedes: { [LP]: { confirmada_por: 'isner@mgg.com', confirmada_en: '2026-11-01T15:00:00Z' } } });
    expect(tieneRevision(o)).toBe(true);
    const t = tablaProductosSp(o);
    expect(t.head).toEqual(['#', 'Producto', 'Cantidad', 'Unidad', 'Los Pinos', 'Matanza', 'A Compras']);
    expect(t.body[0].slice(4)).toEqual(['4', '3', '3']);
    expect(t.body[1].slice(4)).toEqual(['no hay', 'sin responder', '—']);
    const sedes = filasSedesSp(o, { nombre });
    expect(sedes[0].slice(0, 3)).toEqual(['Los Pinos', 'Confirmó', 'Isner']);
    expect(sedes[1].slice(0, 3)).toEqual(['Matanza', 'En curso (1/2)', '—']);
  });

  it('cerrada: lo atendido completo (comprar=false que puso la base) sigue saliendo, con reparto y traslado', () => {
    const its: ItemRevision[] = [
      // Así lo deja la base al cerrar: lo pedido en `cantidad_solicitada`, lo de almacén en `cantidad_almacen`.
      { ...items[0], cantidad_solicitada: 10, cantidad_almacen: 10, cantidad: 0, comprar: false,
        almacen_sedes: { [LP]: { disponible: 10, revisado: true }, [MT]: { disponible: 0, revisado: true } }, almacen_origenes: { [LP]: 10 } },
      { ...items[1], cantidad_solicitada: 50, cantidad_almacen: 20, cantidad: 30, comprar: true,
        almacen_sedes: { [LP]: { disponible: 0, revisado: true }, [MT]: { disponible: 20, revisado: true } }, almacen_origenes: { [MT]: 20 } },
      items[2],
    ];
    const o = orden(its, {
      estado: 'pendiente', sede_destino: MT, revisada_almacen_en: '2026-11-01T16:00:00Z',
      traslados_almacen: { [LP]: { por: 'isner@mgg.com', en: '2026-11-01T18:00:00Z' } },
    });
    expect(its.map(renglonEnPdf)).toEqual([true, true, false]);
    const t = tablaProductosSp(o);
    expect(t.body.map((f) => f[1])).toEqual(['CEMENTO', 'TORNILLO 1/2']);
    expect(t.body[0].slice(4)).toEqual(['10', 'no hay', '0']);
    expect(t.body[1].slice(4)).toEqual(['no hay', '20', '30']);
    expect(filasRepartoSp(o)).toEqual([
      ['Entrega Los Pinos', 'CEMENTO', '10 SACO'],
      ['Entrega Matanza', 'TORNILLO 1/2', '20 und'],
      ['Va a Compras', 'TORNILLO 1/2', '30 und'],
    ]);
    const tr = filasTrasladosSp(o, { nombre });
    expect(tr).toHaveLength(1);
    expect(tr[0][0]).toBe('Los Pinos → Matanza');
    expect(tr[0][1]).toBe('CEMENTO 10 SACO');
    expect(tr[0][2]).toMatch(/^Hecho · Isner · /);
  });

  it('sin función de nombre muestra el correo; una SP sin ítems no rompe', () => {
    const o = orden([], { revision_sedes: { [LP]: { confirmada_por: 'x@mgg.com' } } });
    expect(filasSedesSp(o)[0][2]).toBe('x@mgg.com');
    expect(tablaProductosSp(orden(null as unknown as ItemOrden[])).body).toEqual([]);
  });
});
