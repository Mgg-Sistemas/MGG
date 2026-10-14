/* ============================================================
   MGG · Pedidos · Cómo se arma el total a pagar (14-10-2026)

   total = (Σ ítems − descuento) + IVA + IGTF + ajuste

   …salvo cuando los precios cotizados YA TRAEN el IVA. Es el caso de una
   factura de punto de venta (Super Home, factura 11208, 14-10-2026): cada
   renglón viene con el impuesto adentro y el ticket abajo dice «sub total
   2.459.781,10 · IVA 16 % 127.027,50 · total 2.586.808,60». Si ese IVA se
   SUMA otra vez a los renglones, la OC paga el impuesto dos veces. Y si no se
   carga, la retención de IVA (75 %) no tiene de dónde salir.

   `iva_incluido` = el monto de IVA se GUARDA (para la retención y el libro
   fiscal) pero NO suma al total: ya está adentro de los precios.

   `ajuste` = lo que la factura trae de más o de menos frente a los renglones
   y ningún concepto explica. Un ticket de 47 renglones redondea cada precio
   unitario a dos decimales y la suma se corre unos céntimos (2,52 en el caso
   de Super Home). Se declara con su motivo, no se esconde en un precio.

   Esta es la ÚNICA fórmula: la usan la cotización, la aceptación, las sub-OC,
   la edición de la OC, el cuadre y el trigger `sync_orden_total_desde_oferta`.
   ============================================================ */

export const r2 = (n: unknown): number => Math.round((Number(n) || 0) * 100) / 100;

/** Lo mínimo que hace falta para armar un total. */
export interface PartesDeTotal {
  /** Σ cantidad × precio de los renglones que se compran. */
  subtotal: number;
  descuento?: number | null;
  iva?: number | null;
  igtf?: number | null;
  /** `true` = los precios ya traen el IVA: se guarda pero no suma. */
  iva_incluido?: boolean | null;
  /** Diferencia declarada frente a la factura (puede ser negativa). */
  ajuste?: number | null;
}

/** El IVA que SUMA al total: 0 cuando los precios ya lo traen. */
export function ivaQueSuma(p: Pick<PartesDeTotal, 'iva' | 'iva_incluido'>): number {
  return p.iva_incluido ? 0 : Math.max(0, r2(p.iva));
}

/** El IVA guardado (sume o no): es el que va a la retención y al libro fiscal. */
export function ivaDeclarado(p: Pick<PartesDeTotal, 'iva'>): number {
  return Math.max(0, r2(p.iva));
}

/** Total a pagar a partir de sus partes. */
export function totalDesdePartes(p: PartesDeTotal): number {
  const descuento = Math.max(0, r2(p.descuento));
  const igtf = Math.max(0, r2(p.igtf));
  return r2(Math.max(0, r2(p.subtotal) - descuento) + ivaQueSuma(p) + igtf + r2(p.ajuste));
}

/**
 * Monto de IVA a partir de un % cuando los precios lo traen adentro:
 * base × p / (100 + p). Si no lo traen: base × p / 100.
 */
export function ivaDesdePorcentaje(base: number, pct: number, incluido: boolean): number {
  const b = Math.max(0, Number(base) || 0);
  const p = Math.max(0, Number(pct) || 0);
  if (b <= 0 || p <= 0) return 0;
  return r2(incluido ? (b * p) / (100 + p) : (b * p) / 100);
}

/** % de IVA a partir de un monto (inverso de `ivaDesdePorcentaje`). */
export function porcentajeDesdeIva(base: number, monto: number, incluido: boolean): number {
  const b = Math.max(0, Number(base) || 0);
  const m = Math.max(0, Number(monto) || 0);
  if (b <= 0 || m <= 0) return 0;
  const neto = incluido ? b - m : b;
  if (neto <= 0) return 0;
  return r2((m / neto) * 100);
}

/** Etiqueta del IVA según cómo entra al total. */
export function etiquetaIva(incluido: boolean | null | undefined): string {
  return incluido ? 'IVA (incluido en los precios)' : 'IVA';
}

/** Etiqueta de la línea de ajuste, con su motivo si lo tiene. */
export function etiquetaAjuste(motivo: string | null | undefined): string {
  const m = (motivo ?? '').trim();
  return m ? `Ajuste · ${m}` : 'Ajuste';
}
