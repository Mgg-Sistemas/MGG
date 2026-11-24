/* ============================================================
   Golden Touch · Retenciones · Semillas del registro
   Un único lugar donde se arma la semilla del modal. Antes estaba repetido
   en los tres adaptadores de entrada (buzón, archivo de Compras y orden).
   NO elige cómo se guarda: eso sigue en RegistrarFacturaRetencion
   (`retenerDespues` sobre documento existente vs `registrarFactura` nuevo).
   ============================================================ */
import type { FacturaBuzon } from '@/modules/retenciones/facturasBuzon.repository';
import type { RetencionItem } from '@/modules/retenciones/retenciones.repository';
import type { ImpuestoPendiente } from '@/modules/retenciones/colaPorHacer';
import type { FacturaDeOrigen } from './documentosOrigen.repository';
import type { SemillaFactura } from './RegistrarFacturaRetencion';
import type { SemillaRetencion } from './LibroFiscal';

/** Factura del Buzón Móvil: se registra bajo la empresa de la factura. */
export function semillaFacturaDesdeBuzon(fac: FacturaBuzon, contraparteId: string | null = null): SemillaFactura {
  return {
    direccion: 'practicada',
    contraparteId,
    tipoDocumento: fac.tipoDocumento,
    contraparteNombre: fac.proveedorNombre,
    contraparteRif: fac.proveedorRif,
    moneda: fac.moneda,
    facturaNro: fac.facturaNumero || null,
    facturaControl: fac.facturaControl,
    facturaFecha: fac.facturaFecha,
    facturaTotal: fac.montoTotal,
    baseImponible: fac.montoTotal,
  };
}

/** Archivo que subió Compras y que ya corresponde a una orden conocida. */
export function semillaFacturaDesdeOrdenArchivo(f: FacturaDeOrigen, item: RetencionItem): SemillaFactura {
  const o = item.orden;
  return {
    direccion: 'practicada',
    docKind: f.origen.tipo,
    docId: f.origen.id,
    adjuntoId: f.adjuntoId,
    adjunto: { nombre: f.nombre, bucket: f.bucket, path: f.path },
    contraparteId: o?.proveedor_id ?? null,
    contraparteNombre: item.proveedorNombre,
    moneda: o?.total_moneda === 'Bs' ? 'Bs' : 'USD',
    facturaTotal: o?.total ?? null,
    baseImponible: o ? Math.max(0, o.total - (o.iva_monto ?? 0) - (o.igtf_monto ?? 0)) : null,
    iva: o?.iva_monto ?? 0,
  };
}

/** Orden histórica con factura adjunta: retención suelta, nunca factura nueva. */
export function semillaRetencionDesdeOrden(item: RetencionItem, pends: ImpuestoPendiente[]): SemillaRetencion {
  const o = item.orden;
  if (!o) return { direccion: 'practicada', tipoInicial: pends[0] ?? 'iva' };
  return {
    direccion: 'practicada',
    tipoInicial: pends[0] ?? 'iva',
    docKind: 'oc',
    docId: o.id,
    codigo: o.oc_codigo ?? o.codigo,
    contraparteId: o.proveedor_id,
    contraparteNombre: item.proveedorNombre,
    moneda: o.total_moneda === 'Bs' ? 'Bs' : 'USD',
    total: o.total,
    baseImponible: Math.max(0, o.total - (o.iva_monto ?? 0) - (o.igtf_monto ?? 0)),
    iva: o.iva_monto ?? 0,
  };
}
