/* ============================================================
   MGG · Tesorería · Referencia del pago de una OC (12-11-2026)

   Al subir el comprobante de pago se pide la referencia, con los
   ÚLTIMOS 4 DÍGITOS:
     · Pago en Bs (transferencia / pago móvil) → referencia bancaria.
     · Pago por Binance                        → ID de la orden.
   El efectivo en Bs no lleva referencia (no hay transferencia).
   Queda escrita en el concepto del movimiento (Libro Mayor) y en la
   traza de la OC.
   ============================================================ */
import type { PagoMetodo } from '@/shared/lib/types';

/** Monedas de las patas del pago que llevan monto (> 0). */
export interface PatasPago {
  /** ¿Sale algo en Bs? */
  bs: boolean;
  /** ¿Sale algo en USDT (cuenta de Binance)? */
  usdt: boolean;
  /** ¿Sale algo en otra moneda que no sea Bs (USD, USDT, COP…)? */
  noBs: boolean;
}

export interface ReferenciasRequeridas {
  bs: boolean;
  binance: boolean;
}

const METODOS_BS = ['efectivo_bs', 'transferencia', 'pago_movil'];

/**
 * Qué referencias pide el pago.
 * · Bs: si sale algo en Bs, salvo que la OC diga que lo en Bs se paga en EFECTIVO.
 * · Binance: si sale algo en USDT, o si la OC indica Binance y sale algo que no es Bs.
 */
export function referenciasRequeridas(metodos: PagoMetodo[] | null | undefined, patas: PatasPago): ReferenciasRequeridas {
  const ms = (metodos ?? []).map((m) => m.metodo);
  const deBs = ms.filter((m) => METODOS_BS.includes(m));
  const bsSoloEfectivo = deBs.length > 0 && deBs.every((m) => m === 'efectivo_bs');
  return {
    bs: patas.bs && !bsSoloEfectivo,
    binance: patas.usdt || (ms.includes('binance_usdt') && patas.noBs),
  };
}

/** Deja solo los dígitos (se pegan referencias con espacios o guiones). */
export function soloDigitos(v: string): string {
  return String(v ?? '').replace(/\D/g, '');
}

/** Limpia la referencia según el tipo: para Bs solo dígitos; para Binance letras y números (alfanumérico en mayúsculas). */
export function limpiarReferencia(v: string, que: 'bs' | 'binance'): string {
  if (que === 'binance') {
    return String(v ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  }
  return soloDigitos(v);
}

/** null si está bien; si no, el mensaje de error. */
export function errorReferencia(v: string | null | undefined, que: 'bs' | 'binance'): string | null {
  const d = limpiarReferencia(v ?? '', que);
  const nombre = que === 'bs' ? 'la referencia del pago en Bs (transferencia / pago móvil)' : 'el ID de la orden de Binance';
  const unidad = que === 'bs' ? 'dígitos' : 'caracteres';
  if (!d) return `Indicá ${nombre}: los últimos 4 ${unidad}.`;
  if (d.length !== 4) return `En ${nombre} van exactamente los últimos 4 ${unidad} (cargaste ${d.length}).`;
  return null;
}

/** Texto para el concepto del movimiento según la moneda de la pata. */
export function textoReferencia(moneda: string | null | undefined, refs: { bs?: string | null; binance?: string | null } | null | undefined): string {
  if (!refs) return '';
  const esBs = (moneda ?? '').toUpperCase() === 'BS';
  if (esBs) return refs.bs ? `ref. …${refs.bs}` : '';
  return refs.binance ? `Binance orden …${refs.binance}` : '';
}
