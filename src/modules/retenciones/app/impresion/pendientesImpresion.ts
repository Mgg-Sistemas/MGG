/* ============================================================
   MGG · Retenciones v8 · Pendientes de impresión y entrega (lógica pura)

   La de la maqueta (v8-3-listas.js, v8ItemsImpresion y abrirPendientesImpresion):
   un comprobante practicado, con número y no anulado, está pendiente si no se
   imprimió, si se corrigió después de imprimirse (versión nueva o revisión
   pendiente) o si se imprimió y no se entregó.
   Las columnas impresa_*, entregada_* y revision_pendiente son del paquete 04
   de la base de Retenciones (ficha de BD, §3): hasta que existan, la lista no
   tiene de dónde leer y el diálogo solo se ve en local.
   ============================================================ */
import { aplicarFiltros, buscaEn, type PasaFiltro } from '../listas/filtros';

export type MotivoImpresion = 'sin_imprimir' | 'corregido' | 'sin_entregar';

export const MOTIVO_IMPRESION: Record<MotivoImpresion, string> = {
  sin_imprimir: 'Sin imprimir',
  corregido: 'Corregido después de imprimir',
  sin_entregar: 'Impreso sin entregar',
};

export const ORDENES_IMPRESION: [OrdenImpresion, string][] = [
  ['antiguo', 'Más antiguo primero'], ['reciente', 'Más reciente primero'], ['numero', 'N° de comprobante'], ['proveedor', 'Proveedor (A–Z)'],
];

export type OrdenImpresion = 'antiguo' | 'reciente' | 'numero' | 'proveedor';

/** Un comprobante con sus datos de impresión y entrega. */
export interface RetencionImpresion {
  id: string;
  tipo: string;
  direccion: 'practicada' | 'recibida';
  anulada: boolean;
  numero: string | null;
  /** Fecha de la factura (aaaa-mm-dd). */
  fecha: string;
  proveedor: string;
  rif: string;
  factura: string | null;
  documento: string | null;
  monto: number;
  version: number;
  impresaEn: string | null;
  impresaVersion: number | null;
  entregadaEn: string | null;
  revisionPendiente: boolean;
}

export interface PendienteImpresion {
  r: RetencionImpresion;
  motivo: MotivoImpresion;
}

export interface FiltrosImpresion {
  q: string;
  impuesto: string;
  motivo: string;
  /** Mes de la factura (aaaa-mm); vacío = todos. */
  mes?: string;
  orden: OrdenImpresion;
}

/** Por qué un comprobante está pendiente; null si no lo está. */
export function motivoImpresion(r: RetencionImpresion): MotivoImpresion | null {
  if (r.direccion !== 'practicada' || r.anulada || !r.numero) return null;
  if (!r.impresaEn) return 'sin_imprimir';
  if (r.revisionPendiente || (r.version || 1) > (r.impresaVersion || 0)) return 'corregido';
  return r.entregadaEn ? null : 'sin_entregar';
}

export function pendientesImpresion(xs: readonly RetencionImpresion[]): PendienteImpresion[] {
  const out: PendienteImpresion[] = [];
  for (const r of xs) {
    const motivo = motivoImpresion(r);
    if (motivo) out.push({ r, motivo });
  }
  return out;
}

export const pasaImpresion: PasaFiltro<PendienteImpresion> = (x, campo, v) =>
  campo === 'impuesto' ? x.r.tipo === v : campo === 'motivo' ? x.motivo === v : campo === 'mes' ? x.r.fecha.startsWith(v) : true;

/** Los pendientes que coinciden con la búsqueda (N°, proveedor, RIF, factura u OC). */
export function basePendientes(xs: readonly RetencionImpresion[], q: string): PendienteImpresion[] {
  return pendientesImpresion(xs).filter((x) => buscaEn(q, x.r.numero, x.r.proveedor, x.r.rif, x.r.factura, x.r.documento));
}

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

/** Los meses de las facturas (aaaa-mm), el más reciente primero, con su nombre. */
export function mesesDeFacturas(fechas: readonly string[]): [string, string][] {
  const meses = [...new Set(fechas.map((d) => d.slice(0, 7)).filter((m) => /^\d{4}-\d{2}$/.test(m)))].sort().reverse();
  return meses.map((m) => [m, `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`]);
}

/** Los que se buscan, con los filtros puestos y en el orden elegido. */
export function filtrarPendientesImpresion(xs: readonly RetencionImpresion[], f: FiltrosImpresion): PendienteImpresion[] {
  const base = basePendientes(xs, f.q);
  const puestos = [{ campo: 'impuesto', valor: f.impuesto }, { campo: 'motivo', valor: f.motivo }, { campo: 'mes', valor: f.mes ?? '' }];
  const ys = aplicarFiltros(base, puestos, pasaImpresion);
  const porFecha = (a: PendienteImpresion, b: PendienteImpresion) => a.r.fecha.localeCompare(b.r.fecha) || a.r.id.localeCompare(b.r.id);
  const orden: Record<OrdenImpresion, (a: PendienteImpresion, b: PendienteImpresion) => number> = {
    antiguo: porFecha,
    reciente: (a, b) => -porFecha(a, b),
    numero: (a, b) => (a.r.numero ?? '').localeCompare(b.r.numero ?? ''),
    proveedor: (a, b) => a.r.proveedor.localeCompare(b.r.proveedor, 'es'),
  };
  return ys.sort(orden[f.orden]);
}

/** El texto del motivo; el de «impreso sin entregar» lleva la fecha en que se imprimió. */
export function textoMotivo(x: PendienteImpresion, fecha: (iso: string) => string): string {
  return x.motivo === 'sin_entregar' && x.r.impresaEn ? `${MOTIVO_IMPRESION.sin_entregar} el ${fecha(x.r.impresaEn)}` : MOTIVO_IMPRESION[x.motivo];
}

export const VACIO_IMPRESION = 'Sin comprobantes pendientes de impresión y entrega.';
export const SIN_RESULTADOS = 'Sin resultados con esta búsqueda o estos filtros.';
export const HUELLA_IMPRESION = 'Cada comprobante se imprime desde su vista previa: «🖨 Comprobante» › «Imprimir para entregar». La vista previa se abre encima y vuelve aquí.';
