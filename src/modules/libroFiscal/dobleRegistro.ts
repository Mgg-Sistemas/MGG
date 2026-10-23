/* ============================================================
   Golden Touch · Libro fiscal · Una sola retención de cada impuesto por factura

   Regla del equipo de retenciones (12/10/2026): una factura no puede tener dos
   retenciones vigentes del mismo impuesto en la misma dirección. La factura se
   reconoce por el RIF de la contraparte y su número, no por la OC o la compra
   que la originó: así una OC y su factura no cuentan como dos.

   El IGTF no entra: es una percepción por pago, no una retención por factura.
   Esta guarda es la primera línea; no cubre a dos personas guardando a la vez.
   ============================================================ */
import { labelImpuesto, type DireccionRetencion, type TipoImpuesto } from './retencionesCalculo';

export interface ClaveRetencion {
  direccion: DireccionRetencion;
  tipo: TipoImpuesto;
  contraparteRif?: string | null;
  facturaNumero?: string | null;
}

/** «j-12.345.678-9» → «J123456789». */
export function normalizarRif(v: string | null | undefined): string {
  return String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** «00-0123 » → «123»: sin separadores ni ceros a la izquierda. */
export function normalizarFactura(v: string | null | undefined): string {
  return String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+/, '');
}

/** La retención vigente que ya ocupa esa factura, o null si no hay (o si no se puede saber). */
export function retencionYaRegistrada<T extends ClaveRetencion & { anulada?: boolean | null }>(
  existentes: T[], nueva: ClaveRetencion,
): T | null {
  const rif = normalizarRif(nueva.contraparteRif);
  const factura = normalizarFactura(nueva.facturaNumero);
  if (nueva.tipo === 'igtf' || !rif || !factura) return null;
  return existentes.find((e) => !e.anulada
    && e.direccion === nueva.direccion && e.tipo === nueva.tipo
    && normalizarRif(e.contraparteRif) === rif && normalizarFactura(e.facturaNumero) === factura) ?? null;
}

/** El aviso, nombrando la retención que ya existe. */
export function mensajeDobleRegistro(r: ClaveRetencion & {
  contraparteNombre?: string | null; numeroComprobante?: string | null;
}): string {
  const quien = r.contraparteNombre ? `${r.contraparteNombre} (${r.contraparteRif ?? '—'})` : (r.contraparteRif ?? '—');
  const num = r.numeroComprobante ? `, comprobante ${r.numeroComprobante}` : '';
  return `La factura ${r.facturaNumero ?? '—'} de ${quien} ya tiene una retención de ${labelImpuesto(r.tipo)} vigente${num}. `
    + 'Una factura admite una sola retención por impuesto. Para corregirla, anular primero la retención vigente.';
}
