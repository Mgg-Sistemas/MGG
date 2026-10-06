/* ============================================================
   MGG · Compras · La marca que LLEGÓ, no solo la que se pidió (06-10-2026)

   La marca se cotiza y queda en la OC. Pero el proveedor a veces manda otra
   («no tenía Shell, mandó Castrol»). Antes no quedaba rastro: la ficha solo
   tomaba la marca pedida si estaba vacía, y el kardex no decía nada.

   Regla: UNA sola ficha por producto, y cada ENTRADA guarda con qué marca
   llegó. Al recibir, cada renglón trae «Marca recibida» prellenada con la
   pedida; si se cambia, se exige una nota corta que explique la diferencia.
   La ficha no se renombra: si estaba sin marca toma la que llegó; si ya
   tenía, se respeta (ver identidadProducto.ts).
   ============================================================ */

/** Largo mínimo de la nota cuando la marca cambió. */
export const NOTA_MARCA_MINIMA = 3;

/** Marca «limpia» para comparar y guardar: sin espacios de más, en mayúsculas. */
export function normMarca(v: string | null | undefined): string {
  return (v ?? '').toString().replace(/\s+/g, ' ').trim().toUpperCase();
}

/**
 * ¿Llegó una marca DISTINTA de la pedida?
 * Solo cuenta como cambio cuando se pidió una marca concreta y llegó otra.
 * Si no se pidió marca, anotar la que llegó es un dato, no una diferencia.
 * Si se dejó vacío lo recibido, se entiende que llegó lo pedido.
 */
export function marcaCambio(pedida: string | null | undefined, recibida: string | null | undefined): boolean {
  const p = normMarca(pedida);
  const r = normMarca(recibida);
  return p !== '' && r !== '' && p !== r;
}

/** Con qué marca entra al inventario: la recibida si se indicó, si no la pedida. */
export function marcaQueEntra(pedida: string | null | undefined, recibida: string | null | undefined): string | null {
  const r = normMarca(recibida);
  if (r) return r;
  const p = normMarca(pedida);
  return p || null;
}

export interface RenglonMarca {
  sku: string;
  nombre?: string | null;
  marca?: string | null;
}

export interface MarcaRecepcion {
  sku: string;
  marca_recibida?: string | null;
  nota_marca?: string | null;
}

/**
 * Valida las marcas de una recepción. Devuelve el texto del error, o null si
 * está todo bien. Un renglón cuya marca cambió necesita nota.
 */
export function errorMarcasRecepcion(items: RenglonMarca[], recepciones: MarcaRecepcion[]): string | null {
  const porSku = new Map(recepciones.map((r) => [r.sku, r]));
  for (const it of items) {
    const r = porSku.get(it.sku);
    if (!r) continue;
    if (marcaCambio(it.marca, r.marca_recibida) && normMarca(r.nota_marca).length < NOTA_MARCA_MINIMA) {
      return `${it.nombre ?? it.sku}: llegó ${normMarca(r.marca_recibida)} en vez de ${normMarca(it.marca)}. Escribí una nota corta explicando el cambio de marca.`;
    }
  }
  return null;
}

/** «Pedido: SHELL · Recibido: CASTROL», o null si no hubo cambio. */
export function textoMarcaRecepcion(it: { marca?: string | null; marca_recibida?: string | null }): string | null {
  if (!marcaCambio(it.marca, it.marca_recibida)) return null;
  return `Pedido: ${normMarca(it.marca)} · Recibido: ${normMarca(it.marca_recibida)}`;
}

/** Marca que queda en el detalle del kardex cuando difiere de la pedida. */
export function textoMarcaKardex(pedida: string | null | undefined, recibida: string | null | undefined): string {
  const entra = marcaQueEntra(pedida, recibida);
  if (!entra) return '';
  return marcaCambio(pedida, recibida) ? ` · marca ${entra} (pedida: ${normMarca(pedida)})` : ` · marca ${entra}`;
}

export interface MarcaRecibidaResumen {
  marca: string;
  /** Unidades que entraron con esa marca. */
  cantidad: number;
  /** Cuántas entradas. */
  veces: number;
}

/**
 * Resumen por marca de lo que entró, a partir del kardex: «CASTROL (12) · SHELL (4)».
 * Solo mira entradas con marca; ordena de mayor a menor cantidad.
 */
export function marcasRecibidas(movs: Array<{ tipo?: string | null; delta: number; marca?: string | null }>): MarcaRecibidaResumen[] {
  const acc = new Map<string, MarcaRecibidaResumen>();
  for (const m of movs) {
    const marca = normMarca(m.marca);
    if (!marca || (m.tipo && m.tipo !== 'entrada') || !(Number(m.delta) > 0)) continue;
    const r = acc.get(marca) ?? { marca, cantidad: 0, veces: 0 };
    r.cantidad += Number(m.delta) || 0;
    r.veces += 1;
    acc.set(marca, r);
  }
  return [...acc.values()].sort((a, b) => b.cantidad - a.cantidad || a.marca.localeCompare(b.marca));
}
