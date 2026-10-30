import { describe, expect, it } from 'vitest';
import type { ItemOrden, Orden } from '@/shared/lib/types';
import {
  conMarcasDeSede, desgloseAlmacen, marcarLote, marcasIniciales, mensajeRevisionAlmacen, mensajeRevisionSede,
  mensajeSolicitudPedido, repartoRenglon, resumenRevision, resumenSede, SEDES_REVISION_ALMACEN, sedesQuePuedeResponder,
  textoEstadoSedes, todoRevisado, type ItemRevision, type OrdenRevision,
} from './revisionAlmacen';

const LP = 'LOS PINOS';
const MT = 'CENTRO DE FUNDICION - MATANZAS';

const items: ItemOrden[] = [
  { sku: 'INS-001', nombre: 'CEMENTO', cantidad: 10, precio: 0, unidad: 'SACO', productoId: 'p1' },
  { sku: 'GEN-AB-0', nombre: 'TORNILLO 1/2', cantidad: 50, precio: 0, unidad: 'und', general: true },
  { sku: 'INS-002', nombre: 'GUANTES', cantidad: 4, precio: 0, unidad: 'PAR', comprar: false },
];

/** La SP en revisión con lo que respondió cada sede. */
function enRevision(lp?: [number, number], mt?: [number, number]): ItemRevision[] {
  const sedes = (i: 0 | 1) => {
    const out: Record<string, { disponible: number; revisado: boolean }> = {};
    if (lp) out[LP] = { disponible: lp[i], revisado: true };
    if (mt) out[MT] = { disponible: mt[i], revisado: true };
    return out;
  };
  return [{ ...items[0], almacen_sedes: sedes(0) }, { ...items[1], almacen_sedes: sedes(1) }, items[2]];
}

const orden = (its: ItemOrden[], rs: OrdenRevision['revision_sedes'] = null, extra: Partial<Orden> = {}): OrdenRevision => ({
  id: 'o1', codigo: 'SP-2026-0300', items: its, revision_sedes: rs, revisada_almacen_en: null, nota_almacen: null,
  ...extra,
} as OrdenRevision);

describe('revisión de almacén por sede', () => {
  it('revisan Los Pinos y Matanza, en ese orden', () => {
    expect(SEDES_REVISION_ALMACEN.map((s) => s.etiqueta)).toEqual(['Los Pinos', 'Matanza']);
    expect(sedesQuePuedeResponder(null)).toEqual([LP, MT]);
    expect(sedesQuePuedeResponder([])).toEqual([LP, MT]);
    // ISNER tiene Los Pinos y La Esperanza: responde solo por Los Pinos.
    expect(sedesQuePuedeResponder([LP, 'CENTRO DE ACOPIO - LA ESPERANZA'])).toEqual([LP]);
    expect(sedesQuePuedeResponder(['CENTRO DE ACOPIO - LA ESPERANZA'])).toEqual([]);
  });

  it('las marcas iniciales son de UNA sede y omiten lo desmarcado en la SP', () => {
    const its = enRevision([3, 0]);
    const lp = marcasIniciales(its, LP);
    expect(Object.keys(lp)).toEqual(['INS-001', 'GEN-AB-0']);
    expect(lp['INS-001']).toEqual({ disponible: 3, revisado: true });
    expect(todoRevisado(its, lp)).toBe(true);
    const mt = marcasIniciales(its, MT);
    expect(mt['INS-001']).toEqual({ disponible: 0, revisado: false });
    expect(todoRevisado(its, mt)).toBe(false);
  });

  it('por lote según stock de la sede: lo que alcance, nunca más de lo pedido', () => {
    const m = marcarLote(items, 'stock', new Map([['INS-001', 25], ['GEN-AB-0', 12]]));
    expect(m['INS-001'].disponible).toBe(10);
    expect(m['GEN-AB-0'].disponible).toBe(12);
    expect(todoRevisado(items, m)).toBe(true);
  });

  it('marcar en una sede no toca lo de la otra', () => {
    const its = conMarcasDeSede(enRevision(undefined, [9, 0]), LP, { 'INS-001': { disponible: 3, revisado: true } });
    expect(its[0].almacen_sedes).toEqual({ [MT]: { disponible: 9, revisado: true }, [LP]: { disponible: 3, revisado: true } });
  });

  it('reparto: Los Pinos primero, después Matanza, hasta lo pedido (como la base)', () => {
    const its = enRevision([3, 0], [9, 20]);
    expect(repartoRenglon(its[0])).toEqual({
      origenes: [{ sede: LP, etiqueta: 'Los Pinos', cantidad: 3 }, { sede: MT, etiqueta: 'Matanza', cantidad: 7 }],
      almacen: 10, falta: 0,
    });
    expect(repartoRenglon(its[1])).toEqual({ origenes: [{ sede: MT, etiqueta: 'Matanza', cantidad: 20 }], almacen: 20, falta: 30 });
    expect(desgloseAlmacen(its[0])).toBe('Los Pinos 3 · Matanza 7');
  });

  it('con la SP cerrada manda lo que fijó la base (almacen_origenes)', () => {
    const cerrada: ItemRevision[] = [
      { ...items[0], cantidad_solicitada: 10, cantidad_almacen: 10, cantidad: 0, comprar: false, almacen_origenes: { [MT]: 7, [LP]: 3 } },
      { ...items[1], cantidad_solicitada: 50, cantidad_almacen: 0, cantidad: 50, comprar: true, almacen_origenes: {} },
      items[2],
    ];
    const r = resumenRevision(cerrada);
    expect(r.tiene.map((x) => [x.nombre, x.cantidad])).toEqual([['CEMENTO', 10]]);
    expect(r.falta.map((x) => [x.sku, x.cantidad])).toEqual([['GEN-AB-0', 50]]);
    expect(r.porSede?.map((e) => [e.etiqueta, e.renglones.map((x) => x.cantidad)])).toEqual([['Los Pinos', [3]], ['Matanza', [7]]]);
    expect(desgloseAlmacen(cerrada[0])).toBe('Los Pinos 3 · Matanza 7');
  });

  it('una SP revisada antes del 30-10 (sin sedes) sigue leyéndose', () => {
    const vieja: ItemOrden[] = [{ ...items[0], cantidad_solicitada: 10, cantidad_almacen: 4, cantidad: 6, comprar: true, almacen_revisado: true }];
    const r = resumenRevision(vieja);
    expect(r.tiene.map((x) => x.cantidad)).toEqual([4]);
    expect(r.falta.map((x) => x.cantidad)).toEqual([6]);
    expect(desgloseAlmacen(vieja[0])).toBe('');
    const txt = mensajeRevisionAlmacen(orden(vieja), { revisor: 'ISNER' });
    expect(txt).toContain('👤 Revisó: ISNER');
    expect(txt).toContain('• CEMENTO — 4 SACO');
  });

  it('cómo va cada sede', () => {
    expect(textoEstadoSedes(orden(enRevision()))).toBe('Los Pinos pendiente · Matanza pendiente');
    const o = orden(enRevision([3, 0], [1, 0]), { [LP]: { confirmada_por: 'a@x', confirmada_en: '2026-10-30T15:00:00Z' } });
    o.items[1] = { ...o.items[1], almacen_sedes: { [LP]: { disponible: 0, revisado: true } } } as ItemRevision;
    expect(textoEstadoSedes(o)).toBe('Los Pinos ✓ · Matanza 1/2');
  });

  it('tiene / no tiene de una sede con sus marcas en curso', () => {
    const r = resumenSede(items, LP, { 'INS-001': { disponible: 10, revisado: true }, 'GEN-AB-0': { disponible: 12, revisado: true } });
    expect(r.tiene.map((x) => [x.nombre, x.cantidad])).toEqual([['CEMENTO', 10], ['TORNILLO 1/2', 12]]);
    expect(r.falta.map((x) => [x.nombre, x.cantidad])).toEqual([['TORNILLO 1/2', 38]]);
  });

  it('el mensaje de la sede dice qué tiene, qué no y quién falta', () => {
    const o = orden(enRevision([3, 0]), { [LP]: { confirmada_por: 'a@x', confirmada_en: '2026-10-30T15:00:00Z', nota: 'Cemento abierto' } });
    const txt = mensajeRevisionSede(o, LP, { revisor: 'ISNER' });
    expect(txt).toContain('ALMACÉN LOS PINOS HA REVISADO LA ORDEN SP-2026-0300');
    expect(txt).toContain('👤 Revisó: ISNER');
    expect(txt).toContain('TIENE (Los Pinos)');
    expect(txt).toContain('• CEMENTO — 3 SACO');
    expect(txt).toContain('NO TIENE (Los Pinos)');
    expect(txt).toContain('• CEMENTO — 7 SACO');
    expect(txt).toContain('• TORNILLO 1/2 — 50 und');
    expect(txt).toContain('📝 Cemento abierto');
    expect(txt).toContain('⏳ Falta que responda: Matanza');
    expect(txt).not.toContain('GUANTES');
    expect(txt).not.toContain('️');
  });

  it('el mensaje de la última sede avisa que la revisión quedó completa', () => {
    const conf = { confirmada_por: 'a@x', confirmada_en: '2026-10-30T15:00:00Z' };
    const txt = mensajeRevisionSede(orden(enRevision([3, 0], [9, 0]), { [LP]: conf, [MT]: conf }), MT);
    expect(txt).toContain('ALMACÉN MATANZA HA REVISADO LA ORDEN');
    expect(txt).toContain('Respondieron todos los almacenes');
  });

  it('el mensaje final agrupa lo que entrega cada almacén y lo que va a Compras', () => {
    const conf = (c: string) => ({ confirmada_por: c, confirmada_en: '2026-10-30T15:00:00Z' });
    const cerrada: ItemRevision[] = [
      { ...items[0], cantidad_solicitada: 10, cantidad_almacen: 10, cantidad: 0, comprar: false, almacen_origenes: { [LP]: 3, [MT]: 7 } },
      { ...items[1], cantidad_solicitada: 50, cantidad_almacen: 0, cantidad: 50, comprar: true, almacen_origenes: {} },
      items[2],
    ];
    const txt = mensajeRevisionAlmacen(
      orden(cerrada, { [LP]: conf('isner@x'), [MT]: conf('carlos@x') }, { revisada_almacen_en: '2026-10-30T16:00:00Z' }),
      { nombre: (c) => (c === 'isner@x' ? 'ISNER' : 'CARLOS') },
    );
    expect(txt).toContain('ALMACÉN HA REVISADO LA ORDEN SP-2026-0300');
    expect(txt).toContain('👤 Revisaron: Los Pinos — ISNER · Matanza — CARLOS');
    expect(txt).toContain('📦 *TIENE');
    const iLp = txt.indexOf('🏬 *Los Pinos:*');
    const iMt = txt.indexOf('🏬 *Matanza:*');
    expect(iLp).toBeGreaterThan(0);
    expect(iMt).toBeGreaterThan(iLp);
    expect(txt.slice(iLp, iMt)).toContain('• CEMENTO — 3 SACO');
    expect(txt.slice(iMt)).toContain('• CEMENTO — 7 SACO');
    expect(txt).toContain('🛒 *VA A SOLICITAR A COMPRAS:*');
    expect(txt).toContain('• TORNILLO 1/2 — 50 und');
    expect(txt).not.toContain('GUANTES');
    expect(txt).not.toContain('️');
  });

  it('si entre los almacenes tienen todo, no va nada a Compras', () => {
    const cerrada: ItemRevision[] = [
      { ...items[0], cantidad_solicitada: 10, cantidad_almacen: 10, cantidad: 0, comprar: false, almacen_origenes: { [MT]: 10 } },
    ];
    const txt = mensajeRevisionAlmacen(orden(cerrada, null, { nota_almacen: 'Matanza: retirar en galpón' }));
    expect(txt).toContain('nada, almacén tiene todo');
    expect(txt).toContain('📝 Matanza: retirar en galpón');
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
