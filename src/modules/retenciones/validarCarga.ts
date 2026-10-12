import type { TipoImpuesto } from './retencionesCalculo';

/**
 * Lo que falta para registrar una retención, o null si está todo. El N° de
 * factura es el fiscal (va al comprobante, al libro y a la relación), nunca el
 * código interno de la OC o la compra. El IGTF es una percepción por pago: no
 * lo pide.
 */
export function faltaEnLaCarga(c: { tipo: TipoImpuesto; facturaNumero: string }): string | null {
  if (c.tipo !== 'igtf' && !c.facturaNumero.trim()) {
    return 'N° de factura requerido (el número fiscal, no el código de la OC): figura en el comprobante y en el libro.';
  }
  return null;
}
