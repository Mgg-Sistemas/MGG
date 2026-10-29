/* ============================================================
   MGG · Contabilidad · Saldos (lógica pura)

   Base de los libros y balances: SOLO los comprobantes contabilizados
   (Galac §3.2: un descuadrado no aparece en ningún saldo ni informe).
   Saldo = debe − haber, en Bs y en $, acumulado hasta una fecha. Las
   sumas se hacen en centavos enteros para no arrastrar error de coma
   flotante en miles de renglones.
   ============================================================ */

import type { ContComprobante, ContComprobanteLinea } from '../tipos';

export interface SaldoCuenta {
  debe_ves: number;
  haber_ves: number;
  debe_usd: number;
  haber_usd: number;
  /** debe − haber */
  saldo_ves: number;
  saldo_usd: number;
}

const c = (x: number) => Math.round(x * 100);

/** Las líneas de los comprobantes contabilizados entre dos fechas (inclusive; sin `desde` = desde el inicio). */
export function lineasContabilizadas(
  comprobantes: ContComprobante[], lineas: ContComprobanteLinea[], hasta: string, desde?: string,
): ContComprobanteLinea[] {
  const validos = new Set(comprobantes
    .filter((x) => x.estado === 'contabilizado' && x.fecha <= hasta && (!desde || x.fecha >= desde))
    .map((x) => x.id));
  return lineas.filter((l) => validos.has(l.comprobante_id));
}

/** Saldo de cada cuenta con movimiento: cuenta_id → debe, haber y saldo en las dos monedas. */
export function saldosPorCuenta(lineas: ContComprobanteLinea[]): Map<string, SaldoCuenta> {
  const acc = new Map<string, [number, number, number, number]>();
  for (const l of lineas) {
    const a = acc.get(l.cuenta_id) ?? [0, 0, 0, 0];
    a[0] += c(l.debe_ves); a[1] += c(l.haber_ves); a[2] += c(l.debe_usd); a[3] += c(l.haber_usd);
    acc.set(l.cuenta_id, a);
  }
  const out = new Map<string, SaldoCuenta>();
  for (const [id, [dv, hv, du, hu]] of acc) {
    out.set(id, { debe_ves: dv / 100, haber_ves: hv / 100, debe_usd: du / 100, haber_usd: hu / 100, saldo_ves: (dv - hv) / 100, saldo_usd: (du - hu) / 100 });
  }
  return out;
}
