/* ============================================================
   MGG · Pedidos · Variantes de oferta (alternativas)
   ------------------------------------------------------------
   Un proveedor puede cotizar el MISMO producto en varias
   marcas/modelos: varias filas con el MISMO sku. Esas filas son
   ALTERNATIVAS ("una u otra"), NO se suman: al aceptar la oferta
   se elige UNA por producto y solo esa entra a la OC.

   Estas utilidades agrupan por sku y calculan el total
   "representativo" (una variante por grupo) para mostrar/comparar
   sin duplicar. El representante es la variante MÁS CARA del grupo
   (peor caso, presupuesto conservador); el precio real se fija al
   elegir la marca en la aceptación.
   ============================================================ */

/** Campos mínimos que necesita el cálculo (compatible con ItemOrden y FormItem). */
export interface ItemVariante {
  sku?: string | null;
  nombre?: string | null;
  cantidad: number;
  precio: number;
  precio_usd?: number | null;
}

/** Clave de agrupación: el sku (o el nombre si no hay sku). */
function claveGrupo(it: ItemVariante): string {
  return (it.sku && it.sku.trim()) || (it.nombre && it.nombre.trim()) || '';
}

/** Agrupa los ítems por sku, preservando el orden de aparición. */
export function agruparVariantes<T extends ItemVariante>(items: T[]): T[][] {
  const orden: string[] = [];
  const map = new Map<string, T[]>();
  for (const it of items) {
    const k = claveGrupo(it);
    if (!map.has(k)) { map.set(k, []); orden.push(k); }
    map.get(k)!.push(it);
  }
  return orden.map((k) => map.get(k)!);
}

/** ¿La oferta tiene al menos un producto con varias marcas/modelos (alternativas)? */
export function hayVariantes(items: ItemVariante[]): boolean {
  return agruparVariantes(items).some((g) => g.length > 1);
}

/** Representante de un grupo = la variante con MAYOR total en Bs (cantidad × precio). */
export function representanteGrupo<T extends ItemVariante>(grupo: T[]): T {
  return grupo.reduce((best, it) => {
    const t = (Number(it.cantidad) || 0) * (Number(it.precio) || 0);
    const tb = (Number(best.cantidad) || 0) * (Number(best.precio) || 0);
    return t > tb ? it : best;
  }, grupo[0]);
}

/**
 * Totales "representativos": suman UNA variante por producto (la más cara), de modo
 * que las alternativas del mismo sku NO se dupliquen. Para ofertas sin variantes
 * devuelve exactamente la suma normal (cada sku es su propio grupo de 1).
 */
export function totalesRepresentativos(items: ItemVariante[]): { bcv: number; usd: number } {
  let bcv = 0;
  let usd = 0;
  for (const g of agruparVariantes(items)) {
    const r = representanteGrupo(g);
    const cant = Number(r.cantidad) || 0;
    bcv += cant * (Number(r.precio) || 0);
    usd += cant * (Number(r.precio_usd) || 0);
  }
  return { bcv: Math.round(bcv * 100) / 100, usd: Math.round(usd * 100) / 100 };
}
