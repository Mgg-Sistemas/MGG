/* ============================================================
   MGG · Pedidos · ¿La edición de una OC cambia algo que importa?
   «Editar OC» sobre una OC ya confirmada por el Gerente la devolvía
   a aprobación SIEMPRE, aunque el analista guardara sin tocar nada o
   solo corrigiera la nota (caso real: Compras entró a poner la nota
   de una sub-OC y la OC perdió la confirmación). Lo que justifica
   volver a aprobación es un cambio MATERIAL: ítems (incluida la
   variante marca/modelo), cantidades, precios, proveedor, condición
   de pago o descuento. La nota y el nombre de un producto se guardan
   sin reabrir. Funciones puras: comparables en tests sin base.
   Tolerancia: cantidad a 3 decimales, precio a 2 (menos que eso no
   es una edición humana).
   ============================================================ */

export interface ItemComparable {
  sku: string;
  nombre?: string;
  marca?: string | null;
  modelo?: string | null;
  cantidad: number;
  precio: number;
  precio_usd?: number | null;
  comprar?: boolean;
}

export interface OcComparable {
  items: ItemComparable[];
  condiciones_pago?: string | null;
  descuento_obtenido?: number | null;
  proveedor_id?: string | null;
  notas?: string | null;
}

export interface EdicionComparable {
  items: ItemComparable[];
  /** undefined = «no se tocó»; null = «se vació». */
  condiciones_pago?: string | null;
  descuentoObtenido?: number | null;
  proveedorId?: string | null;
  notas?: string | null;
}

const r2 = (n: unknown): number => Math.round((Number(n) || 0) * 100) / 100;
const r3 = (n: unknown): number => Math.round((Number(n) || 0) * 1000) / 1000;
const txt = (s: unknown): string => (typeof s === 'string' ? s.trim() : '');
/** Identidad de un renglón: SKU + variante (marca/modelo). Cada variante es un renglón propio. */
const clave = (it: ItemComparable): string => `${txt(it.sku)}|${txt(it.marca)}|${txt(it.modelo)}`;
const comprables = (items: ItemComparable[]): ItemComparable[] => (items ?? []).filter((it) => it.comprar !== false);

/** Huella material: renglón · cantidad · precio · precio USD, sin depender del orden. */
function huellaMaterial(items: ItemComparable[]): string {
  return comprables(items).map((it) => `${clave(it)}|${r3(it.cantidad)}|${r2(it.precio)}|${r2(it.precio_usd)}`).sort().join('\n');
}

/** Huella de texto: renglón · nombre. */
function huellaNombres(items: ItemComparable[]): string {
  return comprables(items).map((it) => `${clave(it)}|${txt(it.nombre)}`).sort().join('\n');
}

/** ¿Cambia el proveedor? (undefined = no se tocó; '' y null son «sin proveedor».) */
export function cambiaProveedorOc(oc: OcComparable, edicion: EdicionComparable): boolean {
  if (edicion.proveedorId === undefined) return false;
  return txt(edicion.proveedorId) !== txt(oc.proveedor_id);
}

/** ¿Cambian ítems, variantes, cantidades, precios, proveedor, condición de pago o descuento? */
export function hayCambiosMateriales(oc: OcComparable, edicion: EdicionComparable): boolean {
  if (huellaMaterial(oc.items) !== huellaMaterial(edicion.items)) return true;
  if (cambiaProveedorOc(oc, edicion)) return true;
  if (edicion.condiciones_pago !== undefined && txt(edicion.condiciones_pago) !== txt(oc.condiciones_pago)) return true;
  if (edicion.descuentoObtenido !== undefined && r2(edicion.descuentoObtenido) !== r2(oc.descuento_obtenido)) return true;
  return false;
}

/** ¿Cambia la nota de la OC? */
export function cambiaNota(oc: OcComparable, edicion: EdicionComparable): boolean {
  return edicion.notas !== undefined && txt(edicion.notas) !== txt(oc.notas);
}

/** ¿Cambia el nombre de algún producto? (se guarda y se sincroniza con inventario, sin reabrir) */
export function cambianNombres(oc: OcComparable, edicion: EdicionComparable): boolean {
  return huellaNombres(oc.items) !== huellaNombres(edicion.items);
}

/** ¿Cambia algo de texto (nota o nombres) que hay que guardar aunque no reabra la OC? */
export function cambiaTexto(oc: OcComparable, edicion: EdicionComparable): boolean {
  return cambiaNota(oc, edicion) || cambianNombres(oc, edicion);
}
