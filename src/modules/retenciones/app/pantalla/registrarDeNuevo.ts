/* ============================================================
   MGG · Retenciones v8 · «Registrar <IMP> de nuevo»

   Traslado de `v8AccionRehacer` (v8-3-listas.js, l. 185-190): en Realizadas,
   la retención practicada anulada que no tiene reemplazo ofrece registrar ese
   impuesto otra vez. El registro abre con los datos de la factura de la
   anulada y guarda con el registro de hoy. Una declarada no: primero se
   reabre el período (decisión del 13/10).
   ============================================================ */

import type { RetencionItem, RetencionPracticada } from '../datos/puerta';

/** Con qué datos abre el registro (todos se pueden corregir antes de guardar). */
export interface SemillaRegistro {
  factura: string;
  control: string;
  fecha: string;
  iva: number | null;
  base: number | null;
  /** El N° de la anulada a la que reemplaza, para decirlo en el diálogo. */
  reemplazaA: string | null;
}

export function puedeRegistrarDeNuevo(r: RetencionPracticada, todas: readonly RetencionPracticada[]): boolean {
  if (!r.anulada || r.direccion !== 'practicada' || r.estado === 'declarada') return false;
  return !todas.some((x) => x.id !== r.id && x.tipo === r.tipo && !x.anulada);
}

export function semillaDeAnulada(r: RetencionPracticada): SemillaRegistro {
  return {
    factura: r.facturaNumero ?? '', control: r.facturaControl ?? '', fecha: r.facturaFecha ?? '',
    iva: r.impuesto ?? null, base: r.baseImponible ?? null, reemplazaA: r.numeroComprobante ?? null,
  };
}

/** El documento de la lista de pendientes con que se abre el registro (la anulada deja su impuesto pendiente). */
export function documentoParaRegistrar(r: RetencionPracticada, items: readonly RetencionItem[]): RetencionItem | null {
  return items.find((i) => i.kind === r.docKind && i.id === r.docId) ?? null;
}
