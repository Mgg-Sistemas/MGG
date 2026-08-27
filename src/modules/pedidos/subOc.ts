/* ============================================================
   MGG · Pedidos · Recorte de una oferta a una sub-OC (hija)
   En multi-proveedor las OFERTAS viven en la orden MADRE y cotizan
   TODOS sus ítems, pero cada sub-OC (hija) compra solo una parte.
   Cuando una hija toma valores de la oferta (al aceptarla, al
   re-sincronizarla tras editarla), hay que quedarse SOLO con los
   ítems de la hija y prorratear IVA/IGTF/descuento/efectivo por la
   fracción que la hija representa del total cotizado.
   Es la ÚNICA regla: la usan AsignarProveedoresModal (preview y
   creación), aprobarOrdenConOferta y resincronizarOcDesdeOferta.
   El trigger `sync_orden_total_desde_oferta` de la base NO toca
   hijas a propósito (no sabe en qué moneda nació cada una).
   ============================================================ */

export interface ItemRecortable {
  sku: string;
  cantidad: number;
  precio: number;
  comprar?: boolean;
}

export interface OfertaRecortable<T extends ItemRecortable> {
  items: T[];
  precio_total: number;
  precio_efectivo?: number | null;
  descuento?: number | null;
  iva?: number | null;
  igtf?: number | null;
}

export interface OfertaRecortada<T extends ItemRecortable> {
  /** Solo los ítems de la oferta cuyo SKU pertenece a la hija. */
  items: T[];
  /** Σ cantidad × precio de esos ítems. */
  precio_total: number;
  precio_efectivo: number | null;
  descuento: number | null;
  iva: number | null;
  igtf: number | null;
  /** Fracción del total cotizado que representa la hija (0..1). */
  fraccion: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * SKUs que la hija compra (comprar !== false) y que la oferta NO cotiza o cotiza en $0.
 * Si devuelve algo, la oferta no sirve para esta hija: hay que avisar, nunca perder el
 * ítem en silencio (la madre lo seguiría dando por cubierto).
 */
export function skusSinCotizar(itemsHija: ItemRecortable[], itemsOferta: ItemRecortable[]): string[] {
  const conPrecio = new Set(itemsOferta.filter((it) => (Number(it.precio) || 0) > 0).map((it) => it.sku));
  return itemsHija.filter((it) => it.comprar !== false && !conPrecio.has(it.sku)).map((it) => it.sku);
}

/** Σ cantidad × precio de los ítems que se compran (comprar !== false). */
export function grossDe(items: ItemRecortable[]): number {
  return round2(items.reduce((a, it) => (it.comprar === false ? a : a + (Number(it.cantidad) || 0) * (Number(it.precio) || 0)), 0));
}

/**
 * SKUs que una hija puede tomar de una oferta: los suyos, más los de la madre que ninguna
 * otra hija VIVA cubra (p. ej. se canceló una hermana y este proveedor sí los cotiza).
 * Así una hija puede "absorber" lo que quedó libre sin duplicar lo que otra ya compra.
 */
export function skusAbsorbiblesPorHija(
  skusHija: Iterable<string>,
  skusMadre: Iterable<string>,
  skusCubiertosPorOtras: Iterable<string>,
): string[] {
  const cubiertos = new Set(skusCubiertosPorOtras);
  const permitidos = new Set(skusHija);
  for (const sku of skusMadre) if (!cubiertos.has(sku)) permitidos.add(sku);
  return Array.from(permitidos);
}

/**
 * Recorta una oferta de la madre a lo que le corresponde a una hija.
 * `skusHija`: los SKUs que compra la hija (sus propios items).
 */
export function recortarOfertaAHija<T extends ItemRecortable>(
  oferta: OfertaRecortable<T>,
  skusHija: Iterable<string>,
): OfertaRecortada<T> {
  const set = new Set(skusHija);
  const items = (oferta.items ?? []).filter((it) => set.has(it.sku));
  // Gross de la oferta: su precio_total si lo trae; si no, la suma de sus ítems.
  const grossOferta = (Number(oferta.precio_total) || 0) > 0 ? round2(Number(oferta.precio_total)) : grossDe(oferta.items ?? []);
  const grossHija = grossDe(items);
  const fraccion = grossOferta > 0 ? Math.min(1, grossHija / grossOferta) : (grossHija > 0 ? 1 : 0);
  const prorratear = (v: number | null | undefined): number | null => {
    const n = Number(v) || 0;
    if (n <= 0) return null;
    const p = round2(n * fraccion);
    return p > 0 ? p : null;
  };
  return {
    items,
    precio_total: grossHija,
    precio_efectivo: prorratear(oferta.precio_efectivo),
    descuento: prorratear(oferta.descuento),
    iva: prorratear(oferta.iva),
    igtf: prorratear(oferta.igtf),
    fraccion,
  };
}
