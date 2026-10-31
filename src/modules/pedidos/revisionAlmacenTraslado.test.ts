import { describe, expect, it } from 'vitest';
import type { ItemOrden, Orden } from '@/shared/lib/types';
import {
  mensajeTrasladoSolicitud, motivoTrasladoSp, ordenReparto, repartoRenglon, trasladosDeSolicitud, trasladosPendientes,
  type ItemRevision,
} from './revisionAlmacen';

const LP = 'LOS PINOS';
const MT = 'CENTRO DE FUNDICION - MATANZAS';

const it0: ItemOrden = { sku: 'GEN-A', nombre: 'TORNILLO 1/2', cantidad: 5, precio: 0, unidad: 'und', general: true };
const it1: ItemOrden = { sku: 'INS-1', nombre: 'TUERCA', cantidad: 4, precio: 0, unidad: 'und', productoId: 'p2' };

function cerrada(origenes: Array<Record<string, number>>, extra: Partial<Orden> = {}): Orden {
  const items = [it0, it1].map((it, i) => ({
    ...it, cantidad_solicitada: it.cantidad, cantidad: 0, comprar: false, almacen_origenes: origenes[i],
  })) as ItemRevision[];
  return {
    id: 'o1', codigo: 'SP-2026-0400', items, total: 0, estado: 'atendida_almacen', proveedor_id: null,
    solicitante_email: 'x@x', historial: [], created_at: '2026-10-30T12:00:00Z',
    revisada_almacen_en: '2026-10-30T13:00:00Z', sede_destino: MT, ...extra,
  } as Orden;
}

describe('SP · dónde se necesita y traslado entre almacenes (30-10-2026)', () => {
  it('el reparto empieza por la sede donde se necesita', () => {
    expect(ordenReparto(MT)).toEqual([MT, LP]);
    expect(ordenReparto(null)).toEqual([LP, MT]);
    const enRev: ItemRevision = { ...it0, almacen_sedes: { [LP]: { disponible: 5, revisado: true }, [MT]: { disponible: 2, revisado: true } } };
    expect(repartoRenglon(enRev, MT).origenes).toEqual([
      { sede: LP, etiqueta: 'Los Pinos', cantidad: 3 }, { sede: MT, etiqueta: 'Matanza', cantidad: 2 },
    ]);
    expect(repartoRenglon(enRev).origenes).toEqual([{ sede: LP, etiqueta: 'Los Pinos', cantidad: 5 }]);
  });

  it('Los Pinos tiene todo y se necesita en Matanza: un traslado con stock completo', () => {
    const o = cerrada([{ [LP]: 5 }, { [LP]: 4 }]);
    const ts = trasladosDeSolicitud(o);
    expect(ts).toHaveLength(1);
    expect(ts[0]).toMatchObject({ sede: LP, etiqueta: 'Los Pinos', destino: MT, etiquetaDestino: 'Matanza', completo: true, hecho: null });
    expect(ts[0].renglones.map((r) => [r.sku, r.cantidad, r.productoId])).toEqual([['GEN-A', 5, null], ['INS-1', 4, 'p2']]);
    expect(motivoTrasladoSp(o.codigo, ts[0])).toBe('SP-2026-0400 · el pedido lo tiene Los Pinos, stock completo');
  });

  it('lo que da la propia sede destino no se traslada; si los dos dan, no es stock completo', () => {
    const o = cerrada([{ [MT]: 2, [LP]: 3 }, { [MT]: 4 }]);
    const ts = trasladosDeSolicitud(o);
    expect(ts).toHaveLength(1);
    expect(ts[0].renglones.map((r) => [r.sku, r.cantidad])).toEqual([['GEN-A', 3]]);
    expect(ts[0].completo).toBe(false);
  });

  it('sin destino, sin revisar o ya hecho: no queda pendiente', () => {
    expect(trasladosDeSolicitud(cerrada([{ [LP]: 5 }, { [LP]: 4 }], { sede_destino: null }))).toEqual([]);
    expect(trasladosDeSolicitud(cerrada([{ [LP]: 5 }, { [LP]: 4 }], { revisada_almacen_en: null }))).toEqual([]);
    const hecha = cerrada([{ [LP]: 5 }, { [LP]: 4 }], { traslados_almacen: { [LP]: { por: 'a@b', en: '2026-10-30T14:00:00Z' } } });
    expect(trasladosDeSolicitud(hecha)[0].hecho).toMatchObject({ por: 'a@b' });
    expect(trasladosPendientes(hecha)).toEqual([]);
    expect(trasladosPendientes(cerrada([{ [LP]: 5 }, { [LP]: 4 }]), [MT])).toEqual([]);
  });

  it('el mensaje del traslado dice quién lo tiene y lo enviado (sin selector U+FE0F)', () => {
    const o = cerrada([{ [LP]: 5 }, { [LP]: 4 }]);
    const t = trasladosDeSolicitud(o)[0];
    const m = mensajeTrasladoSolicitud(o, t, [
      { nombre: 'TORNILLO 1/2', producto_nombre: 'TORNILLO HEXAGONAL 1/2', cantidad: 5, unidad: 'und' },
      { nombre: 'TUERCA', producto_nombre: 'TUERCA', cantidad: 4, unidad: 'und' },
    ], { quien: 'ISNER', en: '2026-10-30T14:00:00Z' });
    expect(m).toContain('🔁 *TRASLADO SP-2026-0400 · LOS PINOS → MATANZA*');
    expect(m).toContain('El pedido lo tiene *Los Pinos*: *stock completo*.');
    expect(m).toContain('• TORNILLO 1/2 (TORNILLO HEXAGONAL 1/2) — 5 und');
    expect(m).toContain('• TUERCA — 4 und');
    expect(m).not.toContain('️');
  });
});
