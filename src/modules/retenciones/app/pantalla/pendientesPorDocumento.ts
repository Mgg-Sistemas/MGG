/* ============================================================
   MGG · Retenciones v8 · Por realizar (lógica pura)

   Traslado de `v6PintarPendientes` y `v8BarraPendientes` de la maqueta:
   lo pendiente se agrupa por documento (OC o compra). Cada documento
   muestra cuántas retenciones tiene registradas y qué impuestos le faltan.

   Lo pendiente de un documento son los impuestos que le aplican menos los
   que ya están registrados en el libro y no anulados. Qué aplica lo dice
   `impuestosQueAplican` con la configuración y el catálogo de hoy, nunca
   los archivos cargados en la OC (bug del 20/10: «Pendiente» salía vacío
   porque casi ninguna OC tiene esos archivos; la trampa que GT advirtió,
   «un solo flujo para lo pendiente»). Cuando la base tenga las reglas,
   cambia solo esa función.
   ============================================================ */

import { buscaEn } from '../listas/filtros';
import type { ConceptoRetencion, ConfigRetencion, RetencionItem, RetencionPracticada } from '../datos/puerta';

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

/** El IVA del documento: el de la compra o el de la OC; una OC en divisas no lleva IVA. null = no se sabe. */
function ivaDelDocumento(item: RetencionItem): number | null {
  if (item.kind === 'compra_directa' && item.compra) return Number(item.compra.iva) || 0;
  const iva = item.orden?.iva;
  if (iva != null) return Number(iva) || 0;
  return item.moneda === 'USD' ? 0 : null;
}

/**
 * Los impuestos que aplican a un documento, con la configuración y el
 * catálogo de hoy:
 * · IVA, si la empresa es contribuyente especial y el documento tiene IVA
 *   (o no se sabe: el registro lo pide);
 * · ISLR e ISAE, si hay conceptos activos de ese impuesto en el catálogo.
 */
export function impuestosQueAplican(item: RetencionItem, config: ConfigRetencion, conceptos: readonly ConceptoRetencion[]): string[] {
  const out: string[] = [];
  const iva = ivaDelDocumento(item);
  if (config.esContribuyenteEspecial && (iva == null || iva > 0)) out.push('iva');
  for (const k of ['islr', 'municipal'] as const) if (conceptos.some((c) => c.tipo === k && c.activo)) out.push(k);
  return out;
}

/** Une cada documento pendiente con sus retenciones del libro y lo que le aplica. */
export function documentosPendientes(
  items: readonly RetencionItem[], libro: readonly RetencionPracticada[], aplican: (item: RetencionItem) => string[],
): DocumentoPendiente[] {
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
    const pendientes = [...new Set(aplican(item))].filter((k) => !hechos.has(k)).sort(porOrden);
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
