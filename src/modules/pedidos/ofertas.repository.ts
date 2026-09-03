import { supabase } from '@/shared/lib/supabase';
import type { ItemOrden, OfertaProveedor, OfertaDetalle, OfertaAdjunto } from '@/shared/lib/types';
import { ofertaCubreTodoLoPendiente, type HijaCobertura } from './subOc';

const TABLE = 'ofertas_proveedor';
const BUCKET = 'ofertas-pdf';
const MAX_PDF_BYTES = 10 * 1024 * 1024;

/** El adjunto de una oferta puede ser PDF o imagen (foto de la cotización). */
function esAdjuntoValido(file: File): boolean {
  return file.type === 'application/pdf' || file.type.startsWith('image/');
}

export interface CrearOfertaInput {
  orden_id: string;
  proveedor_id: string;
  items: ItemOrden[];
  precio_total: number;
  /** Precio total si se paga en divisa efectivo (opcional; descuento vs. BCV). */
  precio_efectivo?: number | null;
  /** Descuento aplicado al total BCV (BCV total = subtotal − descuento). */
  descuento?: number | null;
  /** IVA (monto) sobre la factura neta; se suma al total a pagar. */
  iva?: number | null;
  /** IGTF (monto); se suma al total a pagar. */
  igtf?: number | null;
  fecha_entrega_prometida?: string | null;
  condiciones_pago?: string | null;  // 'contra_entrega' | 'anticipado' | 'credito'
  notas?: string | null;
  detalle?: OfertaDetalle | null;
  registrada_por_email: string;
  pdf_path?: string | null;
  pdf_filename?: string | null;
  /** Varios adjuntos (fotos/PDF) de la cotización. */
  adjuntos?: OfertaAdjunto[] | null;
}

/** Quita campos vacíos del detalle; devuelve null si no quedó nada. */
export function limpiarDetalleOferta(d?: OfertaDetalle | null): OfertaDetalle | null {
  if (!d) return null;
  const txt = (s?: string | null) => (s && s.trim() ? s.trim() : undefined);
  const log = d.logistica ?? {};
  const logistica = {
    flete: log.flete ?? undefined,
    transporte: log.transporte ?? undefined,
    embalaje: log.embalaje ?? undefined,
    seguros: log.seguros ?? undefined,
  };
  const hayLog = Object.values(logistica).some((v) => v);
  const out: OfertaDetalle = {
    marca: txt(d.marca), modelo: txt(d.modelo), procedencia: txt(d.procedencia),
    materiales: txt(d.materiales), dimensiones: txt(d.dimensiones), peso: txt(d.peso),
    calidad: txt(d.calidad), logistica: hayLog ? logistica : undefined,
  };
  return Object.values(out).some((v) => v) ? out : null;
}

/** Etiquetas legibles de las condiciones de pago. */
export const CONDICIONES_PAGO: { value: string; label: string }[] = [
  { value: 'contado', label: 'Pago de Contado' },
  { value: 'contra_entrega', label: 'Pago Contra Entrega' },
  { value: 'anticipado', label: 'Pago Anticipado' },
  { value: 'credito', label: 'Pago a Crédito' },
];
export function labelCondicionPago(v?: string | null): string {
  return CONDICIONES_PAGO.find((c) => c.value === v)?.label ?? '—';
}

/**
 * Descuento por pago en divisa efectivo respecto al precio BCV de una oferta.
 * Ej.: BCV 15$, efectivo 10$ → diferencia 5$, pct 33.33% (= 5 / 15).
 * Devuelve null si no hay precio efectivo válido o no representa un ahorro.
 */
export function descuentoEfectivo(precioBcv?: number | null, precioEfectivo?: number | null): { diferencia: number; pct: number } | null {
  const bcv = Number(precioBcv) || 0;
  const efe = Number(precioEfectivo) || 0;
  if (bcv <= 0 || efe <= 0 || efe >= bcv) return null;
  const diferencia = Math.round((bcv - efe) * 100) / 100;
  const pct = Math.round((diferencia / bcv) * 10000) / 100; // % con 2 decimales
  return { diferencia, pct };
}

/** Una fila de la comparativa por producto: precio y total a BCV vs USD, con la
 *  diferencia ($) y la variación (%) por línea. */
export interface FilaComparativaProducto {
  sku: string; nombre: string; cantidad: number;
  marca: string; modelo: string;
  precioBcv: number; totalBcv: number;
  precioUsd: number; totalUsd: number;
  diferencia: number; pct: number;
}

/** Descompone los ítems de una oferta en la tabla BCV vs USD por producto. */
export function comparativaPorProducto(items: ItemOrden[]): FilaComparativaProducto[] {
  return (items ?? []).map((it) => {
    const cantidad = Number(it.cantidad) || 0;
    const precioBcv = Number(it.precio) || 0;
    const precioUsd = Number(it.precio_usd) || 0;
    const totalBcv = Math.round(cantidad * precioBcv * 100) / 100;
    const totalUsd = Math.round(cantidad * precioUsd * 100) / 100;
    const diferencia = Math.round((totalBcv - totalUsd) * 100) / 100;
    const pct = precioBcv > 0 ? Math.round(((precioBcv - precioUsd) / precioBcv) * 10000) / 100 : 0;
    return {
      sku: it.sku, nombre: it.nombre, cantidad,
      marca: (it.marca ?? '').toString(), modelo: (it.modelo ?? '').toString(),
      precioBcv, totalBcv, precioUsd, totalUsd, diferencia, pct,
    };
  });
}

/** Sube la cotización (PDF o imagen) al bucket `ofertas-pdf` y retorna su path. */
export async function subirPdfOferta(
  ordenId: string,
  proveedorId: string,
  file: File,
): Promise<{ path: string; filename: string }> {
  if (!esAdjuntoValido(file)) throw new Error('El archivo debe ser PDF o imagen');
  if (file.size > MAX_PDF_BYTES) throw new Error('El archivo no puede superar 10 MB');

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80);
  // Sufijo aleatorio además del timestamp: al subir VARIOS archivos en el mismo
  // milisegundo (multi-imagen), el path debe ser único o el segundo choca (upsert:false).
  const nonce = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
  const path = `${ordenId}/${proveedorId}-${nonce}-${safeName}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type || 'application/pdf', upsert: false });
  if (error) throw error;
  return { path, filename: file.name };
}

/** Sube VARIOS adjuntos (fotos/PDF) de una oferta y devuelve sus {path, filename}. */
export async function subirAdjuntosOferta(
  ordenId: string,
  proveedorId: string,
  files: File[],
): Promise<OfertaAdjunto[]> {
  const out: OfertaAdjunto[] = [];
  for (const file of files) {
    const { path, filename } = await subirPdfOferta(ordenId, proveedorId, file);
    out.push({ path, filename });
  }
  return out;
}

/** Lista unificada de adjuntos de una oferta: junta el `pdf_path` legacy con `adjuntos`
 *  (sin duplicar). Lo usa la comparativa para mostrar todas las fotos/PDF. */
export function adjuntosDeOferta(oferta: Pick<OfertaProveedor, 'pdf_path' | 'pdf_filename' | 'adjuntos'>): OfertaAdjunto[] {
  const lista = [...(oferta.adjuntos ?? [])];
  if (oferta.pdf_path && !lista.some((a) => a.path === oferta.pdf_path)) {
    lista.unshift({ path: oferta.pdf_path, filename: oferta.pdf_filename ?? 'adjunto' });
  }
  return lista;
}

/** Genera un signed URL de 5 min para descargar un PDF de oferta. */
export async function getPdfOfertaSignedUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300);
  if (error || !data) throw error ?? new Error('No se pudo generar enlace');
  return data.signedUrl;
}

export async function listOfertasByOrden(orden_id: string): Promise<OfertaProveedor[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('orden_id', orden_id)
    .order('precio_total', { ascending: true });
  if (error) throw error;
  return (data ?? []) as OfertaProveedor[];
}

export async function crearOferta(input: CrearOfertaInput): Promise<OfertaProveedor> {
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      orden_id: input.orden_id,
      proveedor_id: input.proveedor_id,
      items: input.items,
      precio_total: input.precio_total,
      precio_efectivo: input.precio_efectivo ?? null,
      descuento: input.descuento ?? null,
      iva: input.iva ?? null,
      igtf: input.igtf ?? null,
      fecha_entrega_prometida: input.fecha_entrega_prometida ?? null,
      condiciones_pago: input.condiciones_pago ?? null,
      notas: input.notas ?? null,
      detalle: limpiarDetalleOferta(input.detalle),
      registrada_por_email: input.registrada_por_email,
      pdf_path: input.pdf_path ?? null,
      pdf_filename: input.pdf_filename ?? null,
      adjuntos: input.adjuntos ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as OfertaProveedor;
}

/** Campos editables de una oferta ya cargada (solo mientras está `pendiente`). */
export interface EditarOfertaInput {
  /** Reasignar la oferta a otro proveedor (corrección de carga). */
  proveedor_id?: string;
  items?: ItemOrden[];
  precio_total?: number;
  precio_efectivo?: number | null;
  descuento?: number | null;
  iva?: number | null;
  igtf?: number | null;
  fecha_entrega_prometida?: string | null;
  condiciones_pago?: string | null;
  notas?: string | null;
  detalle?: OfertaDetalle | null;
  pdf_path?: string | null;
  pdf_filename?: string | null;
  adjuntos?: OfertaAdjunto[] | null;
}

export async function actualizarOferta(
  id: string,
  input: EditarOfertaInput
): Promise<OfertaProveedor> {
  const patch: Record<string, unknown> = {};
  if (input.proveedor_id !== undefined) patch.proveedor_id = input.proveedor_id;
  if (input.items !== undefined) patch.items = input.items;
  if (input.precio_total !== undefined) patch.precio_total = input.precio_total;
  if (input.precio_efectivo !== undefined) patch.precio_efectivo = input.precio_efectivo;
  if (input.descuento !== undefined) patch.descuento = input.descuento;
  if (input.iva !== undefined) patch.iva = input.iva;
  if (input.igtf !== undefined) patch.igtf = input.igtf;
  if (input.fecha_entrega_prometida !== undefined) patch.fecha_entrega_prometida = input.fecha_entrega_prometida;
  if (input.condiciones_pago !== undefined) patch.condiciones_pago = input.condiciones_pago;
  if (input.notas !== undefined) patch.notas = input.notas;
  if (input.detalle !== undefined) patch.detalle = limpiarDetalleOferta(input.detalle);
  if (input.pdf_path !== undefined) patch.pdf_path = input.pdf_path;
  if (input.pdf_filename !== undefined) patch.pdf_filename = input.pdf_filename;
  if (input.adjuntos !== undefined) patch.adjuntos = input.adjuntos;
  const { data, error } = await supabase
    .from(TABLE)
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as OfertaProveedor;
}

export async function eliminarOferta(id: string): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  if (error) throw error;
}

/**
 * Trae de la base lo necesario para decidir el descarte y aplica la regla pura
 * `ofertaCubreTodoLoPendiente` (vive en subOc.ts, con tests).
 */
async function cubreTodoLoPendiente(ordenId: string, itemsOferta: ItemOrden[]): Promise<boolean> {
  const [{ data: orden, error }, { data: hijas, error: hErr }] = await Promise.all([
    supabase.from('ordenes').select('items').eq('id', ordenId).maybeSingle(),
    supabase.from('ordenes').select('items, estado').eq('parent_orden_id', ordenId),
  ]);
  if (error) throw error;
  if (hErr) throw hErr;
  return ofertaCubreTodoLoPendiente(
    (orden?.items ?? []) as ItemOrden[],
    (hijas ?? []) as HijaCobertura[],
    itemsOferta ?? [],
  );
}

/**
 * Acepta una oferta:
 *  - marca esta oferta como `aceptada`,
 *  - descarta las hermanas SOLO si esta oferta cubre todo lo que falta comprar,
 *  - retorna la oferta aceptada actualizada.
 *
 * En una compra MULTIPROVEEDOR cada oferta cubre apenas una parte de los ítems. Descartar
 * a las hermanas dejaba los ítems restantes sin con qué comprarse, y la comparativa las
 * pintaba en rojo («Descartada») como si ya no sirvieran. Por eso el descarte es
 * CONDICIONAL: si al aceptar esta oferta quedan ítems sin cubrir, las demás siguen
 * `pendiente` para cubrirlos — la misma regla que ya aplica `asignarProveedoresAOrden`.
 * No actualiza la orden — eso lo hace el caller (`pedidos.repository.aprobarOrdenConOferta`).
 */
export async function aceptarOferta(
  ofertaId: string,
  decididaPorEmail: string,
  scoreCalculado?: number | null
): Promise<OfertaProveedor> {
  const { data: oferta, error: fetchErr } = await supabase
    .from(TABLE)
    .select('orden_id, items')
    .eq('id', ofertaId)
    .single();
  if (fetchErr || !oferta) throw fetchErr ?? new Error('Oferta no encontrada');
  const { orden_id: ordenId, items: itemsOferta } = oferta as { orden_id: string; items?: ItemOrden[] };

  // Descartar a las hermanas SOLO si esta oferta deja la compra completa.
  if (await cubreTodoLoPendiente(ordenId, itemsOferta ?? [])) {
    const { error: discardErr } = await supabase
      .from(TABLE)
      .update({
        estado: 'descartada',
        decidida_por_email: decididaPorEmail,
        decidida_en: new Date().toISOString(),
      })
      .eq('orden_id', ordenId)
      .neq('id', ofertaId)
      .eq('estado', 'pendiente');
    if (discardErr) throw discardErr;
  }

  // Aceptar la elegida.
  const { data: accepted, error: acceptErr } = await supabase
    .from(TABLE)
    .update({
      estado: 'aceptada',
      decidida_por_email: decididaPorEmail,
      decidida_en: new Date().toISOString(),
      score_calculado: scoreCalculado ?? null,
    })
    .eq('id', ofertaId)
    .select('*')
    .single();
  if (acceptErr) throw acceptErr;
  return accepted as OfertaProveedor;
}

export async function descartarOferta(
  id: string,
  decididaPorEmail: string,
  motivo: string
): Promise<OfertaProveedor> {
  const { data, error } = await supabase
    .from(TABLE)
    .update({
      estado: 'descartada',
      motivo_descarte: motivo,
      decidida_por_email: decididaPorEmail,
      decidida_en: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as OfertaProveedor;
}
