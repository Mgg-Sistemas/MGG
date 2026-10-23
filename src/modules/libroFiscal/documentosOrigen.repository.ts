/* ============================================================
   Golden Touch · Retenciones · Facturas × órdenes, compras y servicios (P03)

   Compras sube los archivos de factura (adjuntos_directos: 'orden_factura'
   en una OC; 'compra' y 'servicio' con es_factura). Retenciones registra
   el documento fiscal desde un archivo: la RPC lo enlaza en la misma
   transacción (p_factura.adjunto_id). Un documento puede cubrir N orígenes
   del mismo proveedor (retencion_documento_origenes); el principal lo copia
   la base y aquí se agregan los otros. Todo detrás de p03Disponible().
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { errorRetencion } from './erroresRetencion';
import type { ModuloDirecto } from '@/modules/pedidos/adjuntosDirectos.repository';

const T_PUENTE = 'retencion_documento_origenes';
const V_ESTADO = 'origen_facturas_adjuntos_estado';
const V_POR_ORIGEN = 'retencion_documentos_por_origen';
const V_SIN_FACTURA = 'origenes_sin_factura';

export type TipoOrigen = 'oc' | 'compra_directa' | 'servicio_directo';
export interface Origen { tipo: TipoOrigen; id: string }

export const COLUMNA_ORIGEN: Record<TipoOrigen, 'orden_id' | 'compra_directa_id' | 'servicio_directo_id'> = {
  oc: 'orden_id', compra_directa: 'compra_directa_id', servicio_directo: 'servicio_directo_id',
};
export const NOMBRE_ORIGEN: Record<TipoOrigen, string> = { oc: 'Orden de compra', compra_directa: 'Compra directa', servicio_directo: 'Servicio directo' };

const texto = (v: unknown) => (v == null || String(v).trim() === '' ? null : String(v));

/* ───────── Archivos de factura de Compras ───────── */

export interface FacturaDeOrigen {
  adjuntoId: string;
  modulo: ModuloDirecto;
  origen: Origen;
  bucket: string;
  path: string;
  nombre: string;
  contentType: string | null;
  subidoPor: string | null;
  subidoEn: string;
  /** Ya es (o está en) un documento fiscal registrado. */
  registrado: boolean;
  documentos: string[];
  /** true: Compras la marcó como factura; null: archivo anterior, sin clasificar (puede ser un pago u otro papel). */
  esFactura?: boolean | null;
}

export function aFacturaDeOrigen(r: Record<string, unknown>): FacturaDeOrigen {
  return {
    adjuntoId: String(r.adjunto_id), modulo: (r.modulo as ModuloDirecto) ?? 'orden_factura',
    origen: { tipo: (r.origen_tipo as TipoOrigen) ?? 'oc', id: String(r.origen_id ?? '') },
    bucket: String(r.bucket ?? ''), path: String(r.path ?? ''), nombre: String(r.nombre ?? '') || 'factura',
    contentType: texto(r.content_type), subidoPor: texto(r.subido_por), subidoEn: String(r.subido_en ?? ''),
    registrado: r.registrado === true, documentos: Array.isArray(r.documentos) ? (r.documentos as string[]) : [],
    esFactura: r.modulo === 'orden_factura' ? true : (typeof r.es_factura === 'boolean' ? r.es_factura : null),
  };
}

/** Construye la semilla para abrir el modal de registro de factura desde un archivo de compras. */
export function semillaDeFacturaOrigen(f: FacturaDeOrigen) {
  return {
    direccion: 'practicada' as const,
    docKind: f.origen.tipo,
    docId: f.origen.id,
    adjuntoId: f.adjuntoId,
    adjunto: { nombre: f.nombre, bucket: f.bucket, path: f.path },
  };
}


/**
 * Los archivos de factura que todavía no son un documento fiscal (Retenciones · Por realizar).
 * Con `origenIds`, solo los de esos orígenes (OC, compras o servicios).
 */
export async function facturasPorRegistrar(origenIds?: string[]): Promise<FacturaDeOrigen[]> {
  if (origenIds && !origenIds.length) return [];
  let q = supabase.from(V_ESTADO).select('*').eq('registrado', false);
  if (origenIds) q = q.in('origen_id', origenIds);
  const { data, error } = await q.order('subido_en');
  if (error) throw errorRetencion(error, 'No se pudieron leer las facturas por registrar.');
  return (data ?? []).map((r) => aFacturaDeOrigen(r as Record<string, unknown>));
}

/** Agrupa por origen: id del origen → sus archivos. */
export function porOrigen(fs: FacturaDeOrigen[]): Map<string, FacturaDeOrigen[]> {
  const m = new Map<string, FacturaDeOrigen[]>();
  for (const f of fs) m.set(f.origen.id, [...(m.get(f.origen.id) ?? []), f]);
  return m;
}

export async function urlFacturaDeOrigen(f: Pick<FacturaDeOrigen, 'bucket' | 'path'>): Promise<string> {
  const { data, error } = await supabase.storage.from(f.bucket).createSignedUrl(f.path, 60 * 10);
  if (error) throw new Error(`No se pudo abrir el archivo: ${error.message}`);
  return data.signedUrl;
}

/* ───────── Recibidas sin factura ───────── */

import { fechaDesdeAgenteRetencion } from './agenteCondiciones.repository';

export const FECHA_PERMISO_RETENCION = '2026-10-01';

export interface OrigenSinFactura { origen: Origen; codigo: string | null; desde: string | null }

/** OC recibidas, compras recepcionadas y servicios finalizados sin ningún archivo que cuente como factura.
 *  Respecto a las órdenes de compra (y recepciones), solo considera las que corresponden al período
 *  en que la empresa es agente de retención. */
export async function origenesSinFactura(): Promise<OrigenSinFactura[]> {
  const [desdeAgente, { data, error }] = await Promise.all([
    fechaDesdeAgenteRetencion(),
    supabase.from(V_SIN_FACTURA).select('*').order('desde', { ascending: true, nullsFirst: false }),
  ]);
  if (error) throw errorRetencion(error, 'No se pudo leer qué recepciones están sin factura.');
  return (data ?? [])
    .map((r) => {
      const x = r as Record<string, unknown>;
      return { origen: { tipo: x.origen_tipo as TipoOrigen, id: String(x.origen_id) }, codigo: texto(x.codigo), desde: texto(x.desde) };
    })
    .filter((o) => {
      const d = (o.desde ?? '').slice(0, 10);
      return !d || d >= desdeAgente;
    });
}

/* ───────── Documentos por origen ───────── */

export interface DocumentoDeOrigen {
  enlaceId: string;
  origen: Origen;
  adjuntoId: string | null;
  documentoId: string;
  facturaNro: string | null;
  facturaControl: string | null;
  facturaFecha: string | null;
  proveedorId: string | null;
  razonSocial: string | null;
  /** Sin retenciones (ni anuladas), sin decisiones y sin notas que la afecten. */
  libre: boolean;
}

export function aDocumentoDeOrigen(r: Record<string, unknown>): DocumentoDeOrigen {
  return {
    enlaceId: String(r.enlace_id), origen: { tipo: (r.origen_tipo as TipoOrigen) ?? 'oc', id: String(r.origen_id ?? '') },
    adjuntoId: texto(r.adjunto_id), documentoId: String(r.documento_id),
    facturaNro: texto(r.factura_nro), facturaControl: texto(r.factura_control), facturaFecha: texto(r.factura_fecha),
    proveedorId: texto(r.proveedor_id), razonSocial: texto(r.razon_social), libre: r.libre === true,
  };
}

/** Los orígenes que cubre una factura. */
export async function origenesDeDocumento(documentoId: string): Promise<DocumentoDeOrigen[]> {
  const { data, error } = await supabase.from(V_POR_ORIGEN).select('*').eq('documento_id', documentoId);
  if (error) throw errorRetencion(error, 'No se pudo leer qué órdenes cubre la factura.');
  return (data ?? []).map((r) => aDocumentoDeOrigen(r as Record<string, unknown>));
}

export interface OrigenDelProveedor { origen: Origen; codigo: string | null; fecha: string | null }

/** Las órdenes, compras y servicios del mismo proveedor (para que una factura cubra varias). */
export async function origenesDelProveedor(proveedorId: string, limite = 60): Promise<OrigenDelProveedor[]> {
  const [desdeAgente, oc, cd, sd] = await Promise.all([
    fechaDesdeAgenteRetencion(),
    supabase.from('ordenes').select('id, oc_codigo, codigo, created_at')
      .eq('proveedor_id', proveedorId)
      .gte('created_at', '2026-09-25T00:00:00Z')
      .order('created_at', { ascending: false }).limit(limite),
    supabase.from('compras_directas').select('id, codigo, created_at').eq('proveedor_id', proveedorId).order('created_at', { ascending: false }).limit(limite),
    supabase.from('servicios_directos').select('id, codigo, created_at').eq('proveedor_id', proveedorId).order('created_at', { ascending: false }).limit(limite),
  ]);
  const error = oc.error ?? cd.error ?? sd.error;
  if (error) throw errorRetencion(error, 'No se pudieron leer las órdenes del proveedor.');
  const fila = (tipo: TipoOrigen) => (r: Record<string, unknown>): OrigenDelProveedor => ({
    origen: { tipo, id: String(r.id) }, codigo: texto(r.oc_codigo ?? r.codigo), fecha: texto(r.created_at),
  });
  return [
    ...((oc.data ?? []) as Record<string, unknown>[]).filter((r) => String(r.created_at ?? '').slice(0, 10) >= desdeAgente).map(fila('oc')),
    ...((cd.data ?? []) as Record<string, unknown>[]).map(fila('compra_directa')),
    ...((sd.data ?? []) as Record<string, unknown>[]).map(fila('servicio_directo')),
  ].sort((a, b) => String(b.fecha ?? '').localeCompare(String(a.fecha ?? '')));
}

/** La factura también cubre otra orden, compra o servicio (del mismo proveedor). */
export async function cubrirOrigen(documentoId: string, origen: Origen): Promise<string> {
  const { data, error } = await supabase.from(T_PUENTE).insert({ documento_id: documentoId, [COLUMNA_ORIGEN[origen.tipo]]: origen.id }).select('id');
  if (error) throw errorRetencion(error, 'No se pudo enlazar la factura con la orden.');
  const id = (data as { id: string }[] | null)?.[0]?.id;
  if (!id) throw new Error('No se enlazó: sin permiso de Retenciones o Tesorería.');
  return id;
}

/** Quita un enlace agregado a mano (no el del origen principal ni el que salió de un archivo). */
export async function dejarDeCubrir(enlace: Pick<DocumentoDeOrigen, 'enlaceId' | 'adjuntoId'>, principal: Origen | null, origen: Origen): Promise<void> {
  if (enlace.adjuntoId) throw new Error('Ese enlace salió del archivo de factura: no se quita.');
  if (principal && principal.tipo === origen.tipo && principal.id === origen.id) throw new Error('Es la orden principal de la factura: no se quita.');
  const { data, error } = await supabase.from(T_PUENTE).delete().eq('id', enlace.enlaceId).select('id');
  if (error) throw errorRetencion(error, 'No se pudo quitar el enlace.');
  if (!data?.length) throw new Error('No se quitó el enlace: sin permiso de Retenciones o Tesorería, o ya no existe.');
}
