import { describe, expect, it } from 'vitest';
import type { RetencionItem, RetencionPracticada } from '../datos/puerta';
import { documentosPendientes, filtrarPendientes, nombreImpuesto, opcionesImpuesto } from './pendientesPorDocumento';

// Datos inventados: ningún proveedor ni monto real.
const item = (id: string, over: Partial<RetencionItem> = {}): RetencionItem => ({
  kind: 'oc', id, ocCodigo: `OC-${id}`, opCodigo: `OP-${id}`, proveedorNombre: `Proveedor ${id}`, proveedorId: `p-${id}`,
  proveedorRif: `J-0000000${id}-0`, condicionLabel: 'Contado', retencionLabel: '—', moneda: 'Bs', total: 1000,
  tesoreria: 'por_pagar', finalizada: false, finalizadaEn: null, tiposComprobante: ['iva', 'islr'], ...over,
});
const ret = (docId: string, tipo: string, over: Partial<RetencionPracticada> = {}) =>
  ({ id: `r-${docId}-${tipo}`, docKind: 'oc', docId, tipo, anulada: false, ...over }) as unknown as RetencionPracticada;

describe('Por realizar: lo pendiente por documento', () => {
  it('lo pendiente es lo que el documento espera menos lo registrado; cuenta las registradas', () => {
    const [d] = documentosPendientes([item('1')], [ret('1', 'iva')]);
    expect(d.pendientes).toEqual(['islr']);
    expect(d.registradas).toBe(1);
  });

  it('una retención anulada no cuenta como registrada: el impuesto vuelve a estar pendiente', () => {
    const [d] = documentosPendientes([item('1')], [ret('1', 'iva', { anulada: true })]);
    expect(d.pendientes).toEqual(['iva', 'islr']);
    expect(d.registradas).toBe(0);
  });

  it('una retención de otro tipo de documento con el mismo id no se cruza', () => {
    const [d] = documentosPendientes([item('1')], [ret('1', 'iva', { docKind: 'compra_directa' } as Partial<RetencionPracticada>)]);
    expect(d.pendientes).toEqual(['iva', 'islr']);
  });

  it('los impuestos salen en el orden de la pantalla, con su nombre corto', () => {
    const [d] = documentosPendientes([item('1', { tiposComprobante: ['municipal', 'iva'] })], []);
    expect(d.pendientes.map(nombreImpuesto)).toEqual(['IVA', 'ISAE']);
  });

  it('el filtro de impuesto ofrece solo los que aparecen, con cuántos documentos', () => {
    const docs = documentosPendientes([item('1'), item('2', { tiposComprobante: ['iva'] })], []);
    expect(opcionesImpuesto(docs)).toEqual([{ valor: 'iva', texto: 'IVA', cuenta: 2 }, { valor: 'islr', texto: 'ISLR', cuenta: 1 }]);
  });
});

describe('Por realizar: búsqueda, filtro y orden', () => {
  const docs = documentosPendientes([
    item('1', { proveedorNombre: 'Ñandú Servicios', proveedorRif: 'J-11111111-1' }),
    item('2', { proveedorNombre: 'Álamo Taller', tiposComprobante: ['iva'] }),
  ], []);

  it('busca por RIF sin guiones y por nombre sin acentos', () => {
    expect(filtrarPendientes(docs, { q: 'j111111111', impuesto: '', orden: 'antiguo' }).map((d) => d.item.id)).toEqual(['1']);
    expect(filtrarPendientes(docs, { q: 'alamo', impuesto: '', orden: 'antiguo' }).map((d) => d.item.id)).toEqual(['2']);
  });

  it('filtra por impuesto pendiente', () => {
    expect(filtrarPendientes(docs, { q: '', impuesto: 'islr', orden: 'antiguo' }).map((d) => d.item.id)).toEqual(['1']);
  });

  it('ordena: el más antiguo primero (el de la base), el más reciente o por proveedor', () => {
    expect(filtrarPendientes(docs, { q: '', impuesto: '', orden: 'reciente' }).map((d) => d.item.id)).toEqual(['2', '1']);
    expect(filtrarPendientes(docs, { q: '', impuesto: '', orden: 'proveedor' }).map((d) => d.item.id)).toEqual(['2', '1']);
  });
});
