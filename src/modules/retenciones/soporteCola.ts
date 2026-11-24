/* ============================================================
   Golden Touch · Retenciones · Soporte de la cola «Por hacer»

   La fila de la cola y el modal de detalle deben abrir el MISMO
   archivo. Este helper guarda el origen del soporte (Buzón, archivo
   de Compras o factura de recepción) para que ninguno de los dos
   lugares tenga que adivinar el bucket por el nombre del campo.
   ============================================================ */
import type { FacturaDeOrigen } from '@/modules/libroFiscal/documentosOrigen.repository';
import { urlFacturaDeOrigen } from '@/modules/libroFiscal/documentosOrigen.repository';
import { obtenerUrlAdjunto } from './adjuntosBuzon';
import { urlRetencion } from './retenciones.repository';
import type { FacturaBuzon } from './facturasBuzon.repository';
import type { TipoOrigenCola } from './colaPorHacer';

export interface SoporteCola {
  origen: TipoOrigenCola;
  archivoNombre: string;
  archivoPath?: string;
  rawFacturaOrigen?: FacturaDeOrigen;
  rawBuzon?: FacturaBuzon;
}

/** Extrae de un item de la cola solo lo necesario para abrir su soporte. */
export function soporteDeItem(it: {
  origen: TipoOrigenCola;
  archivoNombre: string;
  archivoPath?: string;
  rawFacturaOrigen?: FacturaDeOrigen;
  rawBuzon?: FacturaBuzon;
}): SoporteCola {
  return {
    origen: it.origen,
    archivoNombre: it.archivoNombre,
    archivoPath: it.archivoPath,
    rawFacturaOrigen: it.rawFacturaOrigen,
    rawBuzon: it.rawBuzon,
  };
}

/** URL firmada del soporte, resuelta según el origen que lo trajo a la cola. */
export async function urlSoporteCola(s: SoporteCola): Promise<string> {
  if (s.origen === 'buzon' && s.archivoPath) return obtenerUrlAdjunto(s.archivoPath);
  if (s.origen === 'compras_archivo' && s.rawFacturaOrigen) return urlFacturaDeOrigen(s.rawFacturaOrigen);
  if (s.origen === 'compras_orden' && s.archivoPath) return urlRetencion(s.archivoPath);
  throw new Error('No se encontró el archivo adjunto');
}
