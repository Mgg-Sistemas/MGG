/* ============================================================
   MGG · Retenciones v8 · Por realizar: lo que acompaña a la lista

   Traslado de `v6PintarPendientes` de la maqueta (las piezas de arriba de
   la lista y los botones de cada fila), con lógica que ya existía en las
   ramas del módulo de hoy:
   · el aviso del pago mayor al debido (C2 a, fix/retenciones-aviso-retencion-compra);
   · lo retenido al pagar que no llegó al libro (C1, fix/retenciones-retenido-al-pagar);
   · los archivos de la factura cargados en Compras («📎 Factura», R3-13).
   Solo lógica pura: la lectura va por la puerta.
   ============================================================ */

import type { RetencionItem } from '../datos/puerta';

/* ───────── El aviso del pago mayor al debido (C2 a) ───────── */

export interface CompraParaAviso {
  /** La compra ya se pagó (finalizada o con egreso de caja). */
  pagada: boolean;
  retencionMonto: number | null | undefined;
  retPagoMonto: number | null | undefined;
  moneda: string | null | undefined;
}

const monto = (n: number, moneda: string | null | undefined) =>
  `${moneda === 'Bs' ? 'Bs' : '$'} ${n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** El aviso, o null si la retención y lo descontado al pagar coinciden (o si todavía no se pagó). */
export function avisoRetencionPago(c: CompraParaAviso): string | null {
  const ret = Number(c.retencionMonto) || 0;
  const pago = Number(c.retPagoMonto) || 0;
  if (!c.pagada || ret <= 0 || Math.abs(ret - pago) < 0.01) return null;
  if (pago <= 0) return `Pago efectuado sin descontar la retención de IVA (${monto(ret, c.moneda)}): el monto pagado al proveedor supera el debido.`;
  return `Monto descontado al pagar: ${monto(pago, c.moneda)}. Retención de IVA de la compra: ${monto(ret, c.moneda)}.`;
}

/** El aviso de un documento de la lista: solo las compras directas guardan lo descontado al pagar. */
export function avisoDeDocumento(item: RetencionItem): string | null {
  const c = item.compra;
  if (item.kind !== 'compra_directa' || !c) return null;
  return avisoRetencionPago({ pagada: c.estado === 'finalizada' || !!c.caja_mov_id, retencionMonto: c.retencion_monto, retPagoMonto: c.ret_pago_monto, moneda: c.moneda });
}

/* ───────── Los archivos de la factura (R3-13) ───────── */

export interface ArchivoFactura {
  /** Dónde lo guardó Compras: la OC (bucket compras-oc) o la compra directa. */
  origen: 'oc' | 'compra';
  path: string;
  nombre: string;
}

export function archivosFactura(item: RetencionItem): ArchivoFactura[] {
  if (item.kind === 'compra_directa') {
    return (item.compra?.facturas ?? []).filter((f) => f?.path).map((f) => ({ origen: 'compra' as const, path: f.path, nombre: f.filename || 'factura' }));
  }
  const o = item.orden;
  return o?.factura_path ? [{ origen: 'oc', path: o.factura_path, nombre: o.factura_nombre || 'factura' }] : [];
}

/** Una fila de Compras tal como llega de la base. */
type FilaCompras = Record<string, unknown>;

/**
 * Los archivos de la factura por documento («oc:<id>» o «compra_directa:<id>»),
 * desde las filas de Compras. Para Realizadas y el Libro, cuyas filas no traen
 * el documento. Una compra vieja sin `facturas` usa su `adjunto_path`.
 */
export function archivosDeFilas(ocs: readonly FilaCompras[], compras: readonly FilaCompras[]): Map<string, ArchivoFactura[]> {
  const m = new Map<string, ArchivoFactura[]>();
  for (const o of ocs) {
    if (typeof o.factura_path === 'string' && o.factura_path) {
      m.set(`oc:${String(o.id)}`, [{ origen: 'oc', path: o.factura_path, nombre: typeof o.factura_nombre === 'string' && o.factura_nombre ? o.factura_nombre : 'factura' }]);
    }
  }
  for (const c of compras) {
    const lista = Array.isArray(c.facturas) ? (c.facturas as { path?: unknown; filename?: unknown }[]) : [];
    let xs: ArchivoFactura[] = lista.filter((f) => typeof f?.path === 'string' && f.path)
      .map((f) => ({ origen: 'compra' as const, path: String(f.path), nombre: typeof f.filename === 'string' && f.filename ? f.filename : 'factura' }));
    if (!xs.length && typeof c.adjunto_path === 'string' && c.adjunto_path) {
      xs = [{ origen: 'compra', path: c.adjunto_path, nombre: typeof c.adjunto_nombre === 'string' && c.adjunto_nombre ? c.adjunto_nombre : 'factura' }];
    }
    if (xs.length) m.set(`compra_directa:${String(c.id)}`, xs);
  }
  return m;
}

/* ───────── Lo retenido al pagar, sin registrar (C1) ───────── */

export type DocConRetencion = 'oc' | 'compra_directa' | 'servicio_directo';

export interface RetenidoAlPagar {
  kind: DocConRetencion;
  id: string;
  codigo: string | null;
  proveedorId: string | null;
  proveedorNombre: string | null;
  proveedorRif: string | null;
  /** Moneda del documento: la de `retenido`. */
  moneda: string;
  total: number;
  /** Lo que se restó al pagar, en la moneda del documento. */
  retenido: number;
  retenidoBs: number | null;
  retenidoUsd: number | null;
  /** Bs por $ con que se pagó. */
  tasa: number | null;
}

/** Una retención del libro, con lo mínimo para saber a qué documento apunta. */
export interface RegistroDelLibro {
  docKind: string;
  docId: string | null;
  direccion: string;
  anulada: boolean;
}

/** Lo retenido al pagar que todavía no tiene una retención practicada viva del mismo documento. */
export function retenidoSinRegistrar(docs: readonly RetenidoAlPagar[], libro: readonly RegistroDelLibro[]): RetenidoAlPagar[] {
  const vivas = new Set(libro.filter((r) => r.docId && !r.anulada && r.direccion === 'practicada').map((r) => `${r.docKind}:${r.docId}`));
  return docs.filter((d) => (Number(d.retenido) || 0) > 0 && !vivas.has(`${d.kind}:${d.id}`));
}

/** El documento de la lista con que se abre el registro. El servicio directo no está en la lista: no tiene. */
export function itemDelRetenido(r: RetenidoAlPagar, items: readonly RetencionItem[]): RetencionItem | null {
  if (r.kind === 'servicio_directo') return null;
  return items.find((i) => i.kind === r.kind && i.id === r.id) ?? null;
}
