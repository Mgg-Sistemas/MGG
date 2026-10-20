/* ============================================================
   MGG · Retenciones v8 · Por realizar (lógica pura)

   Traslado de `v6PintarPendientes` y `v8BarraPendientes` de la maqueta:
   lo pendiente se agrupa por documento (OC o compra). Cada documento
   muestra cuántas retenciones tiene registradas y qué impuestos le faltan.

   Con los datos de hoy, lo pendiente de un documento es lo que la pantalla
   de producción ya considera (sus comprobantes cargados) menos lo que ya
   está registrado en el libro y no está anulado. Cuando la puerta sepa los
   impuestos que aplican por regla, esta función recibe esa lista y no cambia.
   ============================================================ */

import { buscaEn } from '../listas/filtros';
import type { RetencionItem, RetencionPracticada } from '../datos/puerta';

/** El nombre corto de cada impuesto en pantalla, como en la maqueta. */
const NOMBRE: Record<string, string> = { iva: 'IVA', islr: 'ISLR', municipal: 'ISAE', regional: 'Estadal', igtf: 'IGTF' };
export const nombreImpuesto = (k: string): string => NOMBRE[k] ?? k.toUpperCase();

export interface DocumentoPendiente {
  item: RetencionItem;
  /** Retenciones del documento ya registradas en el libro (sin las anuladas). */
  registradas: number;
  /** Claves de los impuestos que le faltan, en el orden de la pantalla. */
  pendientes: string[];
}

export type OrdenPendientes = 'antiguo' | 'reciente' | 'proveedor';

export interface FiltroPendientes {
  q: string;
  /** Clave del impuesto; '' = todos. */
  impuesto: string;
  orden: OrdenPendientes;
}

const ORDEN_IMPUESTOS = ['iva', 'islr', 'municipal', 'regional', 'igtf'];
const porOrden = (a: string, b: string) => {
  const ia = ORDEN_IMPUESTOS.indexOf(a), ib = ORDEN_IMPUESTOS.indexOf(b);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
};

/** Une cada documento pendiente con sus retenciones del libro. */
export function documentosPendientes(items: readonly RetencionItem[], libro: readonly RetencionPracticada[]): DocumentoPendiente[] {
  const delDoc = new Map<string, RetencionPracticada[]>();
  for (const r of libro) {
    if (r.anulada || !r.docId) continue;
    const clave = `${r.docKind}:${r.docId}`;
    const xs = delDoc.get(clave);
    if (xs) xs.push(r); else delDoc.set(clave, [r]);
  }
  return items.map((item) => {
    const rs = delDoc.get(`${item.kind}:${item.id}`) ?? [];
    const hechos = new Set(rs.map((r) => r.tipo as string));
    const pendientes = [...new Set(item.tiposComprobante as string[])].filter((k) => !hechos.has(k)).sort(porOrden);
    return { item, registradas: rs.length, pendientes };
  });
}

/** Los impuestos que aparecen en la lista, con cuántos documentos tiene cada uno (para el filtro). */
export function opcionesImpuesto(docs: readonly DocumentoPendiente[]): { valor: string; texto: string; cuenta: number }[] {
  const cuenta = new Map<string, number>();
  for (const d of docs) for (const k of d.pendientes) cuenta.set(k, (cuenta.get(k) ?? 0) + 1);
  return [...cuenta.keys()].sort(porOrden).map((k) => ({ valor: k, texto: nombreImpuesto(k), cuenta: cuenta.get(k) ?? 0 }));
}

/** Búsqueda (proveedor, RIF, OC u OP, sin acentos), filtro por impuesto y orden. */
export function filtrarPendientes(docs: readonly DocumentoPendiente[], f: FiltroPendientes): DocumentoPendiente[] {
  const xs = docs.filter((d) =>
    buscaEn(f.q, d.item.proveedorNombre, d.item.proveedorRif, d.item.ocCodigo, d.item.opCodigo)
    && (!f.impuesto || d.pendientes.includes(f.impuesto)));
  // Las listas llegan en el orden de la base (de la más antigua a la más reciente).
  if (f.orden === 'reciente') return xs.reverse();
  if (f.orden === 'proveedor') return xs.sort((a, b) => a.item.proveedorNombre.localeCompare(b.item.proveedorNombre, 'es'));
  return xs;
}
