import { describe, expect, it } from 'vitest';
import type { RetencionItem, RetencionPracticada } from '../datos/puerta';
import { CONFIG_RETENCION_DEFECTO, type ConceptoRetencion } from '../../retencionesCalculo';
import { documentosPendientes, filtrarPendientes, impuestosQueAplican, nombreImpuesto, opcionesImpuesto } from './pendientesPorDocumento';

// Datos inventados: ningún proveedor ni monto real.
const item = (id: string, over: Partial<RetencionItem> = {}): RetencionItem => ({
  kind: 'oc', id, ocCodigo: `OC-${id}`, opCodigo: `OP-${id}`, proveedorNombre: `Proveedor ${id}`, proveedorId: `p-${id}`,
  proveedorRif: `J-0000000${id}-0`, condicionLabel: 'Contado', retencionLabel: '—', moneda: 'Bs', total: 1000,
  tesoreria: 'por_pagar', finalizada: false, finalizadaEn: null, tiposComprobante: ['iva', 'islr'], ...over,
});
const ret = (docId: string, tipo: string, over: Partial<RetencionPracticada> = {}) =>
  ({ id: `r-${docId}-${tipo}`, docKind: 'oc', docId, tipo, anulada: false, ...over }) as unknown as RetencionPracticada;

// Para probar la agrupación: lo que aplica se toma de una lista dada (aquí, la de tiposComprobante del item).
const porLista = (items: RetencionItem[], libro: RetencionPracticada[]) => documentosPendientes(items, libro, (it) => it.tiposComprobante as string[]);

describe('Por realizar: lo pendiente por documento', () => {
  it('lo pendiente es lo que el documento espera menos lo registrado; cuenta las registradas', () => {
    const [d] = porLista([item('1')], [ret('1', 'iva')]);
    expect(d.pendientes).toEqual(['islr']);
    expect(d.registradas).toBe(1);
  });

  it('una retención anulada no cuenta como registrada: el impuesto vuelve a estar pendiente', () => {
    const [d] = porLista([item('1')], [ret('1', 'iva', { anulada: true })]);
    expect(d.pendientes).toEqual(['iva', 'islr']);
    expect(d.registradas).toBe(0);
  });

  it('una retención de otro tipo de documento con el mismo id no se cruza', () => {
    const [d] = porLista([item('1')], [ret('1', 'iva', { docKind: 'compra_directa' } as Partial<RetencionPracticada>)]);
    expect(d.pendientes).toEqual(['iva', 'islr']);
  });

  it('los impuestos salen en el orden de la pantalla, con su nombre corto', () => {
    const [d] = porLista([item('1', { tiposComprobante: ['municipal', 'iva'] })], []);
    expect(d.pendientes.map(nombreImpuesto)).toEqual(['IVA', 'ISAE']);
  });

  it('el filtro de impuesto ofrece solo los que aparecen, con cuántos documentos', () => {
    const docs = porLista([item('1'), item('2', { tiposComprobante: ['iva'] })], []);
    expect(opcionesImpuesto(docs)).toEqual([{ valor: 'iva', texto: 'IVA', cuenta: 2 }, { valor: 'islr', texto: 'ISLR', cuenta: 1 }]);
  });
});

describe('Por realizar: búsqueda, filtro y orden', () => {
  const docs = porLista([
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

describe('Por realizar: qué impuestos aplican (bug del 20/10: «Pendiente» vacío y sin «Registrar»)', () => {
  const concepto = (tipo: ConceptoRetencion['tipo'], activo = true) => ({ id: tipo, tipo, activo } as ConceptoRetencion);
  const conIva = (iva: number | null, over: Partial<RetencionItem> = {}) => item('1', { tiposComprobante: [], orden: { iva } as RetencionItem['orden'], ...over });

  it('una OC sin comprobantes cargados igual tiene lo pendiente: no depende de los archivos', () => {
    const [d] = documentosPendientes([conIva(160)], [], (it) => impuestosQueAplican(it, CONFIG_RETENCION_DEFECTO, [concepto('islr'), concepto('municipal')]));
    expect(d.pendientes).toEqual(['iva', 'islr', 'municipal']);
  });

  it('el IVA aplica si la empresa es agente y el documento tiene IVA, o no se sabe; solo un 0 escrito lo descarta', () => {
    expect(impuestosQueAplican(conIva(160), CONFIG_RETENCION_DEFECTO, [])).toEqual(['iva']);
    expect(impuestosQueAplican(conIva(null, { moneda: 'Bs' }), CONFIG_RETENCION_DEFECTO, [])).toEqual(['iva']);
    // La moneda de la OC no cuenta: «USD» es su valor por defecto (bug del 20/10, «no sale ningún IVA»).
    expect(impuestosQueAplican(conIva(null, { moneda: 'USD' }), CONFIG_RETENCION_DEFECTO, [])).toEqual(['iva']);
    expect(impuestosQueAplican(conIva(0), CONFIG_RETENCION_DEFECTO, [])).toEqual([]);
    expect(impuestosQueAplican(conIva(160), { ...CONFIG_RETENCION_DEFECTO, esContribuyenteEspecial: false }, [])).toEqual([]);
  });

  it('ISLR e ISAE aplican si hay conceptos activos de ese impuesto', () => {
    expect(impuestosQueAplican(conIva(0), CONFIG_RETENCION_DEFECTO, [concepto('islr', false), concepto('municipal')])).toEqual(['municipal']);
  });

  it('lo ya registrado sale de lo pendiente; lo anulado vuelve', () => {
    const aplica = () => ['iva', 'islr'];
    expect(documentosPendientes([conIva(160)], [ret('1', 'iva')], aplica)[0].pendientes).toEqual(['islr']);
    expect(documentosPendientes([conIva(160)], [ret('1', 'iva', { anulada: true })], aplica)[0].pendientes).toEqual(['iva', 'islr']);
  });
});
