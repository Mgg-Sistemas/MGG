/* ============================================================
   MGG · Compras · El código y el nombre que se MUESTRAN de un renglón (12-11-2026)

   La SP con nombre general nace con un código PROVISIONAL «GEN-…» (solo vive dentro
   de la solicitud). Cuando Compras lo liga a su producto del inventario, el renglón
   conserva ese SKU por dentro —oferta ↔ orden se casan por SKU—, pero hacia afuera
   (pantallas y PDF) tiene que verse el producto REAL: «MAN-002 · CURVAS 1/2», nunca
   «GEN-MWC83RKC-4». Mientras no está ligado no tiene código: se muestra «—».
   ============================================================ */
import type { ItemOrden } from '@/shared/lib/types';

/** ¿Es un código provisional de nombre general (GEN-…)? */
export function esSkuProvisional(sku: string | null | undefined): boolean {
  return /^GEN-/i.test(String(sku ?? '').trim());
}

type RenglonCodigo = Pick<ItemOrden, 'sku' | 'productoId'> & { sku_inventario?: string | null };

/**
 * El código que se muestra: el del renglón si es real; el del producto ligado si era
 * provisional; vacío si todavía no tiene producto. `skuDe` resuelve el SKU por id de
 * producto (para los renglones ligados antes de que se guardara `sku_inventario`).
 */
export function skuVisible(it: RenglonCodigo, skuDe?: (productoId: string) => string | null | undefined): string {
  const sku = String(it.sku ?? '').trim();
  if (!esSkuProvisional(sku)) return sku;
  const real = String(it.sku_inventario ?? '').trim() || (it.productoId && skuDe ? String(skuDe(it.productoId) ?? '').trim() : '');
  return real && !esSkuProvisional(real) ? real : '';
}

/** Igual que skuVisible, con «—» cuando no hay código (para tablas y PDF). */
export function skuOGuion(it: RenglonCodigo, skuDe?: (productoId: string) => string | null | undefined): string {
  return skuVisible(it, skuDe) || '—';
}

/** ¿Sigue siendo un nombre general SIN producto? (la etiqueta «nombre general» solo va ahí). */
export function esGeneralPendiente(it: Pick<ItemOrden, 'productoId'> & { general?: boolean | null; sku?: string | null }): boolean {
  return (!!it.general || esSkuProvisional(it.sku)) && !it.productoId;
}
