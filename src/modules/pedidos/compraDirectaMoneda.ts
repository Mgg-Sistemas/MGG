/* ============================================================
   MGG · Compras directas · Costo en dólares de una compra en Bs
   El inventario (kardex + PMP) está SIEMPRE en dólares. Una compra
   directa puede montarse y pagarse en bolívares; al recibirla, el
   costo unitario tiene que convertirse a $ con la tasa BCV de la
   compra. Antes no se convertía: `costo = gasto / cantidad` entraba
   tal cual, y una cafetera de 367.606 Bs quedó valorada en
   $367.606 (CD-2026-0054; 26 de 27 compras en Bs recibidas así).
   Funciones puras, sin base: se testean solas.
   ============================================================ */

/** ¿La compra está en bolívares? (cualquier otra cosa se trata como $). */
export function esCompraEnBs(moneda: string | null | undefined): boolean {
  return String(moneda ?? '').trim().toLowerCase() === 'bs';
}

/** Tasa utilizable: un NÚMERO finito mayor que 0 (un string numérico no vale: el tipo no miente). */
export function tasaValida(t: unknown): t is number {
  return typeof t === 'number' && Number.isFinite(t) && t > 0;
}

/**
 * Costo unitario que entra al inventario (en $).
 *  · Compra en $: gasto / cantidad a 2 decimales (comportamiento de siempre).
 *  · Compra en Bs: (gasto / cantidad) / tasa, a 4 decimales (los artículos
 *    baratos en Bs valen centavos de dólar; a 2 decimales se irían a 0).
 *  · Compra en Bs sin tasa: error. Nunca se deja entrar un costo en Bs como $.
 *  · Sin gasto o sin cantidad: 0 (entrada sin costo, no recalcula el PMP).
 */
export function costoUnitarioUsd(gasto: number | null | undefined, cantidad: number, moneda: string | null | undefined, tasaBs?: number | null): number {
  const g = Math.max(0, Number(gasto) || 0);
  const c = Number(cantidad) || 0;
  if (g <= 0 || c <= 0) return 0;
  if (!esCompraEnBs(moneda)) return Math.round((g / c) * 100) / 100;
  if (!tasaValida(tasaBs)) {
    throw new Error('Esta compra está en bolívares y no hay tasa BCV para convertirla a dólares. Pedile a Compras que cargue la tasa en «✎ Factura/precios» y volvé a intentar.');
  }
  return Math.round((g / c / tasaBs) * 10000) / 10000;
}

/** Fecha (YYYY-MM-DD) en hora de Venezuela de un timestamp ISO. `tasa_cambio.fecha` se guarda en
 *  hora Venezuela: recortar el ISO en UTC corría al día siguiente entre las 20:00 y las 23:59. */
export function fechaVE(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas' }).format(d);
}

/** Con qué día se ancla la tasa de una compra que no la guardó al montar. */
export type AnclajeTasa = 'pago' | 'creacion';

/** Fecha con la que se busca la tasa de una compra sin tasa guardada: el día del PAGO (los
 *  bolívares salieron a la tasa de ese día) o, si aún no se pagó, el de creación de la compra.
 *  No se usa `updated_at`: lo reescribe cada paso (pagar, facturas, retención, recibir). */
export function fechaTasaCompra(compra: { created_at?: string | null }, fechaPagoIso?: string | null): { fecha: string; anclaje: AnclajeTasa } | null {
  const pago = fechaVE(fechaPagoIso);
  if (pago) return { fecha: pago, anclaje: 'pago' };
  const creacion = fechaVE(compra.created_at);
  return creacion ? { fecha: creacion, anclaje: 'creacion' } : null;
}

/** Tasa en un solo formato para pantalla y kardex: «777,42 Bs/$» (hasta 4 decimales). */
export function fmtTasa(t: number | null | undefined): string {
  if (!tasaValida(t)) return '—';
  return `${t.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} Bs/$`;
}

/** Costo unitario en $ con hasta 4 decimales: la vista previa muestra lo mismo que se escribe. */
export function fmtUsd4(n: number | null | undefined): string {
  return `$ ${(Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}
