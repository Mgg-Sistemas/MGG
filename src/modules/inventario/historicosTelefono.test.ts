import { describe, expect, it } from 'vitest';
import type { SolicitudSalida } from '@/shared/lib/types';
import type { SalidaTelefono } from './inventarioTelefono';
import {
  esDelUsuario, mensajeFilaTraslado, mezclarSalidas, mezclarTraslados, movioStock,
  ordenDeSalidaTelefono, ordenDeTrasladoTelefono, ordenDeTrasladoTelefonoLote, trasladoDeMovimiento,
} from './historicosTelefono';

const tel = (id: string, actor: string, at: string, almacen = 'General') =>
  ({ id, actor, created_at: at, almacen, fotos: [] }) as unknown as SalidaTelefono;
const sol = (id: string, actor: string, at: string, extra: Partial<SolicitudSalida> = {}) =>
  ({ id, actor, created_at: at, scope: 'salida', tipo: 'material', estado: 'ejecutada', mov_ref: null, almacen_origen: 'General', items: [], ...extra }) as unknown as SolicitudSalida;

describe('históricos del teléfono (03-11-2026)', () => {
  it('cada almacenista con sede ve solo lo suyo; sin sede, todo', () => {
    expect(esDelUsuario({ actor: 'carlos@x.com' }, 'CARLOS@x.com')).toBe(true);
    expect(esDelUsuario({ actor: 'otro@x.com', ejecutada_por: 'carlos@x.com' }, 'carlos@x.com')).toBe(true);
    expect(esDelUsuario({ actor: 'isner@x.com' }, 'carlos@x.com')).toBe(false);
    expect(esDelUsuario({ actor: 'isner@x.com' }, null)).toBe(true);
  });

  it('junta teléfono y módulo, de la más nueva a la más vieja, solo las que descontaron', () => {
    const filas = mezclarSalidas(
      [tel('t1', 'carlos@x.com', '2026-11-03T12:00:00Z'), tel('t2', 'isner@x.com', '2026-11-03T13:00:00Z')],
      [sol('m1', 'carlos@x.com', '2026-11-03T14:00:00Z'), sol('m2', 'carlos@x.com', '2026-11-03T15:00:00Z', { mov_ref: 'manual_externo' })],
      'General', 'carlos@x.com',
    );
    expect(filas.map((f) => f.id)).toEqual(['m:m1', 't:t1']);
    expect(movioStock({ estado: 'ejecutada', mov_ref: 'manual_externo', tipo: 'material' })).toBe(false);
  });

  it('lee las dos patas de un traslado del teléfono e ignora los reversos', () => {
    const base = { id: 'a', producto_id: 'p', at: '2026-11-03T10:00:00Z', producto: { nombre: 'CABLE', sku: 'X-1', unidad: 'M' } };
    const sale = trasladoDeMovimiento({ ...base, delta: -3, almacen: 'General', detalle: 'Transferencia a Los Pinos · para obra (teléfono)' });
    expect(sale).toMatchObject({ origen: 'General', destino: 'Los Pinos', cantidad: 3, motivo: 'para obra' });
    const entra = trasladoDeMovimiento({ ...base, delta: 3, almacen: 'Los Pinos', detalle: 'Transferencia desde General · para obra (teléfono)' });
    expect(entra).toMatchObject({ origen: 'General', destino: 'Los Pinos' });
    expect(trasladoDeMovimiento({ ...base, delta: 3, almacen: 'General', detalle: 'Reverso: no entró' })).toBeNull();
    expect(mezclarTraslados([sale!], [], 'Los Pinos')).toHaveLength(1);
  });
});

describe('salida con varios materiales (04-11-2026)', () => {
  it('junta los materiales que comparten N° SAT en una sola salida', () => {
    const a = { ...tel('a', 'carlos@x.com', '2026-11-04T10:00:00Z'), codigo: 'SAT-0009', producto_nombre: 'CABLE' } as SalidaTelefono;
    const b = { ...tel('b', 'carlos@x.com', '2026-11-04T10:00:01Z'), codigo: 'SAT-0009', producto_nombre: 'TUBO' } as SalidaTelefono;
    const c = { ...tel('c', 'carlos@x.com', '2026-11-04T11:00:00Z'), codigo: 'SAT-0010', producto_nombre: 'CINTA' } as SalidaTelefono;
    const filas = mezclarSalidas([a, b, c], [], 'General', null);
    expect(filas).toHaveLength(2);
    const g = filas.find((f) => f.id === 't:a');
    expect(g && g.origen === 'telefono' ? g.grupo.map((x) => x.producto_nombre) : []).toEqual(['CABLE', 'TUBO']);
  });
});

describe('Solicitado por en salidas y traslados del teléfono (18-11-2026)', () => {
  it('pasa Solicitado por a la orden de salida en PDF y al traslado (WhatsApp y PDF)', () => {
    const s = {
      ...tel('s1', 'carlos@x.com', '2026-11-18T14:00:00Z'),
      codigo: 'SAT-CARLOS-0002', producto_id: 'p1', producto_nombre: 'MANGUERA', unidad: 'MTS',
      cantidad: 5, motivo: 'Mantenimiento', autorizado_por: 'ENDER MEJIA', retorna: false, retornado: 0, retornos: [],
    } as SalidaTelefono;
    const os = ordenDeSalidaTelefono(s, 'CARLOS MACHADO', 12);
    expect(os.sol.solicitante).toBe('ENDER MEJIA');
    expect(os.opciones.solicitadoPor).toBe('ENDER MEJIA');
    expect(os.opciones.autorizadoPor).toBeUndefined();

    const mov = trasladoDeMovimiento({
      id: 'm1', producto_id: 'p1', delta: -4, almacen: 'MATANZA',
      detalle: 'Transferencia a LOS PINOS · Para taller (teléfono)',
      solicitante: 'PEDRO ROJAS', at: '2026-11-18T15:00:00Z', ref_codigo: 'TRA-CARLOS-0001',
      producto: { nombre: 'GUANTES', sku: 'EPP-01', unidad: 'PAR' },
    });
    expect(mov?.solicitado_por).toBe('PEDRO ROJAS');

    const ot = ordenDeTrasladoTelefono(mov!, 'CARLOS MACHADO');
    expect(ot.sol.solicitante).toBe('PEDRO ROJAS');
    expect(ot.opciones.solicitadoPor).toBe('PEDRO ROJAS');
    expect(ot.opciones.autorizadoPor).toBeUndefined();

    const otLote = ordenDeTrasladoTelefonoLote({
      origen: 'MATANZA', destino: 'LOS PINOS', motivo: 'Para taller', solicitadoPor: 'PEDRO ROJAS',
      quien: 'CARLOS MACHADO', actor: 'carlos@x.com', actorName: 'CARLOS MACHADO', at: '2026-11-18T15:00:00Z',
      codigo: 'TRA-CARLOS-0001', lineas: [{ producto_id: 'p1', nombre: 'GUANTES', unidad: 'PAR', cantidad: 4, precio: 3 }],
    });
    expect(otLote.sol.solicitante).toBe('PEDRO ROJAS');
    expect(otLote.opciones.solicitadoPor).toBe('PEDRO ROJAS');

    const [fila] = mezclarTraslados([mov!], [], 'MATANZA');
    const wsp = mensajeFilaTraslado(fila, 'CARLOS MACHADO');
    expect(wsp).toContain('👤 *Solicitado por:* PEDRO ROJAS');
    expect(wsp).not.toContain('Autorizado por');
  });
});
