import type { RetencionItem } from './retenciones.repository';
import type { SemillaRetencion } from './LibroFiscal';

/**
 * Con qué datos se abre el libro desde una fila: el documento, la contraparte y
 * la base. La compra directa y la OC traen aparte el IVA y el IGTF, que van
 * dentro de su total: la base es el total sin los dos, con lo exento dentro.
 */
export function semillaDeItem(it: RetencionItem): SemillaRetencion {
  const doc = it.kind === 'compra_directa' ? it.compra : it.orden;
  const iva = Number(doc?.iva) || 0;
  const igtf = Number(doc?.igtf) || 0;
  return {
    direccion: 'practicada',
    docKind: it.kind, docId: it.id, codigo: it.ocCodigo,
    contraparteId: it.proveedorId,
    contraparteNombre: it.proveedorNombre,
    contraparteRif: it.proveedorRif,
    moneda: it.moneda === 'USD' ? 'USD' : it.moneda,
    total: it.total, iva,
    baseImponible: Math.max(0, it.total - iva - igtf),
  };
}
