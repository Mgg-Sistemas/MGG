import type { TipoImpuesto } from './retencionesCalculo';

const FECHA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * Lo que falta para registrar una retención, o null si está todo. El N° de
 * factura es el fiscal (va al comprobante, al libro y a la relación), nunca el
 * código interno de la OC o la compra. El IGTF es una percepción por pago: no
 * lo pide. La fecha la piden todos: de ella salen el período y la quincena.
 */
export function faltaEnLaCarga(c: { tipo: TipoImpuesto; facturaNumero: string; facturaFecha: string }): string | null {
  if (c.tipo !== 'igtf' && !c.facturaNumero.trim()) {
    return 'N° de factura requerido (el número fiscal, no el código de la OC): figura en el comprobante y en el libro.';
  }
  if (!FECHA.test(c.facturaFecha.trim())) return 'Fecha de la factura requerida: determina el período y la quincena.';
  return null;
}
