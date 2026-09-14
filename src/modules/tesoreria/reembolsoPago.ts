/* ============================================================
   MGG · Tesorería · Pago de OC con retención y reembolso

   Retención: al pagar se puede indicar que la factura tiene retención.
   Ese monto se RESTA del total: se paga la factura menos la retención.

   Reembolso: si lo cargado supera lo que hay que pagar (factura de 200,
   se pagaron 300), con una confirmación se registran 200 como pago de la
   OC y los 100 restantes salen en OTRO movimiento de caja, «REEMBOLSO DE
   ORDEN DE COMPRA OC-…». El dinero salió igual; solo queda separado.
   ============================================================ */

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Categoría del movimiento de caja del excedente. */
export const CATEGORIA_REEMBOLSO_OC = 'reembolso_oc';

/** Concepto del movimiento del excedente. */
export function conceptoReembolsoOc(codigo: string, sufijo?: string | null): string {
  return `REEMBOLSO DE ORDEN DE COMPRA ${codigo}${sufijo ? ` · ${sufijo}` : ''}`;
}

/** Lo que se paga de una factura con retención (nunca negativo). */
export function aPagarConRetencion(totalFactura: number, retencion: number): number {
  return r2(Math.max(0, r2(totalFactura) - Math.max(0, r2(retencion))));
}

/** Una pata de pago: el monto en su moneda y su equivalente en USD. */
export interface PataPago { monto: number; montoUsd: number }

/**
 * Separa el excedente de un multipago. El reembolso se toma desde la ÚLTIMA
 * pata hacia la primera; si una pata queda partida, cada parte conserva la
 * proporción entre su moneda y el USD. Devuelve las patas del pago (en su
 * orden original, sin las que quedan en cero) y las del reembolso.
 */
export function separarReembolso<T extends PataPago>(patas: T[], excesoUsd: number): { pago: T[]; reembolso: T[] } {
  let resta = r2(excesoUsd);
  const pago = patas.map((p) => ({ ...p }));
  const reembolso: T[] = [];
  for (let i = pago.length - 1; i >= 0 && resta > 0.004; i--) {
    const p = pago[i];
    const usd = r2(p.montoUsd);
    if (usd <= 0) continue;
    if (resta >= usd - 0.005) {
      reembolso.unshift({ ...p });
      resta = r2(resta - usd);
      pago[i] = { ...p, monto: 0, montoUsd: 0 };
      continue;
    }
    const montoRe = r2(p.monto * (resta / usd));
    reembolso.unshift({ ...p, monto: montoRe, montoUsd: resta });
    pago[i] = { ...p, monto: r2(p.monto - montoRe), montoUsd: r2(usd - resta) };
    resta = 0;
  }
  return { pago: pago.filter((p) => p.monto > 0), reembolso };
}
