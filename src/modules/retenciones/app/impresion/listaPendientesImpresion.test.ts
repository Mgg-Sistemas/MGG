import { describe, expect, it } from 'vitest';
import { deRetencionPracticada, filtrarPendientesImpresion, mesesDeFacturas, motivoImpresion, textoMotivo, type RetencionImpresion } from './listaPendientesImpresion';
import type { RetencionPracticada } from '../datos/puerta';

// Datos inventados, con las columnas del paquete 04 (impresa_*, entregada_*, revision_pendiente).
const r = (over: Partial<RetencionImpresion> = {}): RetencionImpresion => ({
  id: 'x', tipo: 'iva', direccion: 'practicada', anulada: false, numero: '20261000000011', fecha: '2026-10-03', proveedor: 'Proveedor Alfa C.A.', rif: 'J-00000001-0',
  factura: '000123', documento: 'OC-0001', monto: 120, version: 1, impresaEn: null, impresaVersion: null, entregadaEn: null, revisionPendiente: false, ...over,
});

describe('los pendientes de impresión y entrega (maqueta v8ItemsImpresion; ficha de BD §3)', () => {
  it('sin imprimir', () => {
    expect(motivoImpresion(r())).toBe('sin_imprimir');
  });
  it('corregido después de imprimir: una versión nueva, o la revisión pendiente', () => {
    expect(motivoImpresion(r({ impresaEn: '2026-10-04', impresaVersion: 1, version: 2 }))).toBe('corregido');
    expect(motivoImpresion(r({ impresaEn: '2026-10-04', impresaVersion: 1, revisionPendiente: true }))).toBe('corregido');
  });
  it('impreso sin entregar', () => {
    expect(motivoImpresion(r({ impresaEn: '2026-10-04', impresaVersion: 1 }))).toBe('sin_entregar');
  });
  it('impreso y entregado, anulado, sin número o de un cliente: no es pendiente', () => {
    expect(motivoImpresion(r({ impresaEn: '2026-10-04', impresaVersion: 1, entregadaEn: '2026-10-05' }))).toBeNull();
    expect(motivoImpresion(r({ anulada: true }))).toBeNull();
    expect(motivoImpresion(r({ numero: null }))).toBeNull();
    expect(motivoImpresion(r({ direccion: 'recibida' }))).toBeNull();
  });
  it('filtra por búsqueda, impuesto y motivo, y ordena (por omisión, el más antiguo primero)', () => {
    const xs = [r({ id: 'a', fecha: '2026-10-05' }), r({ id: 'b', fecha: '2026-10-01', tipo: 'islr' }), r({ id: 'c', fecha: '2026-10-02', impresaEn: '2026-10-04', impresaVersion: 1 })];
    expect(filtrarPendientesImpresion(xs, { q: '', impuesto: '', motivo: '', orden: 'antiguo' }).map((x) => x.r.id)).toEqual(['b', 'c', 'a']);
    expect(filtrarPendientesImpresion(xs, { q: '', impuesto: 'iva', motivo: 'sin_imprimir', orden: 'antiguo' }).map((x) => x.r.id)).toEqual(['a']);
    expect(filtrarPendientesImpresion(xs, { q: '000123', impuesto: '', motivo: '', orden: 'reciente' }).map((x) => x.r.id)).toEqual(['a', 'c', 'b']);
    expect(filtrarPendientesImpresion(xs, { q: '', impuesto: '', motivo: '', mes: '2026-09', orden: 'antiguo' })).toEqual([]);
  });
  it('los meses del filtro Período, el más reciente primero; el motivo «impreso sin entregar» lleva su fecha', () => {
    expect(mesesDeFacturas(['2026-09-30', '2026-10-02', '2026-10-05', ''])).toEqual([['2026-10', 'Octubre 2026'], ['2026-09', 'Septiembre 2026']]);
    const x = { r: r({ impresaEn: '2026-10-04', impresaVersion: 1 }), motivo: 'sin_entregar' as const };
    expect(textoMotivo(x, (d) => d.split('-').reverse().join('/'))).toBe('Impreso sin entregar el 04/10/2026');
  });
  it('convierte RetencionPracticada a RetencionImpresion con deRetencionPracticada', () => {
    const prac: RetencionPracticada = {
      id: 'ret-100',
      tipo: 'iva',
      direccion: 'practicada',
      anulada: false,
      anuladaEn: null,
      motivoAnulacion: null,
      numeroComprobante: '20261000000099',
      facturaFecha: '2026-10-15',
      facturaNumero: 'FAC-0099',
      docCodigo: 'OC-0099',
      montoRetenido: 50.5,
      contraparteNombre: 'Inversiones Omega C.A.',
      contraparteRif: 'J-12345678-9',
      createdAt: '2026-10-15T12:00:00Z',
    } as unknown as RetencionPracticada;
    const imp = deRetencionPracticada(prac);
    expect(imp.id).toBe('ret-100');
    expect(imp.tipo).toBe('iva');
    expect(imp.numero).toBe('20261000000099');
    expect(imp.fecha).toBe('2026-10-15');
    expect(imp.proveedor).toBe('Inversiones Omega C.A.');
    expect(imp.rif).toBe('J-12345678-9');
    expect(imp.monto).toBe(50.5);
    expect(imp.impresaEn).toBeNull();
    expect(motivoImpresion(imp)).toBe('sin_imprimir');
  });
});
