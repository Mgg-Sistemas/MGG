import type { CotizacionMoneda, MonedaCotizacion } from '@/shared/lib/types';

export type TasasBcvCotizacion = Omit<CotizacionMoneda, 'moneda'>;

const redondear4 = (n: number) => Math.round((Number(n) || 0) * 10000) / 10000;

/** USD a BCV por cada EUR a BCV: (Bs/USD) ÷ (Bs/EUR). */
export function factorEuroAUsdBcv(tasas: TasasBcvCotizacion): number {
  const usd = Number(tasas.tasa_usd_bcv) || 0;
  const eur = Number(tasas.tasa_eur_bcv) || 0;
  return usd > 0 && eur > 0 ? usd / eur : 0;
}

/** El valor nominal que usa toda la compra (USD a BCV), sin importar cómo se escribió. */
export function usdBcvDesdeMoneda(
  monto: number,
  moneda: MonedaCotizacion,
  tasas: TasasBcvCotizacion,
): number {
  const valor = Math.max(0, Number(monto) || 0);
  if (moneda === 'USD') return redondear4(valor);
  return redondear4(valor * factorEuroAUsdBcv(tasas));
}

/** Vuelve de USD a BCV a la moneda que ve el usuario, sin cambiar el valor de la oferta. */
export function monedaDesdeUsdBcv(
  usdBcv: number,
  moneda: MonedaCotizacion,
  tasas: TasasBcvCotizacion,
): number {
  const valor = Math.max(0, Number(usdBcv) || 0);
  if (moneda === 'USD') return redondear4(valor);
  const factor = factorEuroAUsdBcv(tasas);
  return factor > 0 ? redondear4(valor / factor) : 0;
}

/** Bolívares al cambio BCV del valor nominal ya expresado en USD a BCV. */
export function bsDesdeUsdBcv(usdBcv: number, tasas: TasasBcvCotizacion): number {
  return Math.round(Math.max(0, Number(usdBcv) || 0) * (Number(tasas.tasa_usd_bcv) || 0) * 100) / 100;
}
