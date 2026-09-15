/* ============================================================
   MGG · Tesorería · Pago de OC con retención y reembolso

   Retención: al pagar se puede indicar que la factura tiene retención.
   Ese monto se RESTA del total: se paga la factura menos la retención.

   Reembolso: si lo cargado supera lo que hay que pagar (factura de 200,
   se pagaron 300), con una confirmación se registran 200 como pago de la
   OC y los 100 restantes salen en OTRO movimiento de caja, «REEMBOLSO DE
   ORDEN DE COMPRA OC-…». El dinero salió igual; solo queda separado.

   Desde el 15/09/2026 lo mismo aplica al pagar compras directas y servicios
   directos: «REEMBOLSO DE COMPRA DIRECTA CD-…» / «REEMBOLSO DE SERVICIO
   DIRECTO SD-…», con la misma categoría de caja.
   ============================================================ */

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Categoría del movimiento de caja del excedente (OC, orden de servicio y directos). */
export const CATEGORIA_REEMBOLSO_OC = 'reembolso_oc';

/** Concepto del movimiento del excedente de una orden. Una orden de servicio lo dice. */
export function conceptoReembolsoOc(codigo: string, sufijo?: string | null, clase?: string | null): string {
  const que = clase === 'servicio' ? 'ORDEN DE SERVICIO' : 'ORDEN DE COMPRA';
  return `REEMBOLSO DE ${que} ${codigo}${sufijo ? ` · ${sufijo}` : ''}`;
}

/** Concepto del movimiento del excedente de una compra o un servicio directo. */
export function conceptoReembolsoDirecto(kind: 'compra' | 'servicio', codigo: string, sufijo?: string | null): string {
  const que = kind === 'servicio' ? 'SERVICIO DIRECTO' : 'COMPRA DIRECTA';
  return `REEMBOLSO DE ${que} ${codigo}${sufijo ? ` · ${sufijo}` : ''}`;
}

/** Lo que se paga de una factura con retención (nunca negativo). */
export function aPagarConRetencion(totalFactura: number, retencion: number): number {
  return r2(Math.max(0, r2(totalFactura) - Math.max(0, r2(retencion))));
}

/** Retención cargada en Tesorería: en Bs y en $, con la tasa (Bs por $) usada. */
export interface RetencionDetalle { bs: number; usd: number; tasa: number }

/**
 * La retención se escribe en Bs o en $ y la otra moneda sale con la tasa
 * (editable). `desde` es el campo que se tecleó por última vez.
 */
export function convertirRetencion(valor: number, desde: 'bs' | 'usd', tasa: number): { bs: number; usd: number } {
  const v = Math.max(0, r2(valor));
  const t = Number(tasa) || 0;
  if (desde === 'bs') return { bs: v, usd: t > 0 ? r2(v / t) : 0 };
  return { bs: t > 0 ? r2(v * t) : 0, usd: v };
}

/**
 * Columnas de retención y reembolso de una compra o un servicio directo pagado.
 * Se llaman `ret_pago_*` porque `compras_directas.retencion_*` ya es la retención de IVA.
 */
export function camposPagoDirecto(
  retencion: number | null | undefined, detalle: RetencionDetalle | null | undefined,
  reembolso: number | null | undefined, moneda: string | null | undefined,
) {
  const ret = r2(Math.max(0, Number(retencion) || 0));
  const ree = r2(Math.max(0, Number(reembolso) || 0));
  return {
    ret_pago_monto: ret,
    ret_pago_bs: ret > 0 && detalle ? detalle.bs : null,
    ret_pago_usd: ret > 0 && detalle ? detalle.usd : null,
    ret_pago_tasa: ret > 0 && detalle ? detalle.tasa : null,
    reembolso_monto: ree,
    reembolso_moneda: ree > 0 ? (moneda === 'Bs' ? 'Bs' : 'USD') : null,
  };
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
