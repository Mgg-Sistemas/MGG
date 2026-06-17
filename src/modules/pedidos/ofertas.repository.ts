import { supabase } from '@/shared/lib/supabase';
import type { ItemOrden, OfertaProveedor, OfertaDetalle } from '@/shared/lib/types';

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
  fecha_entrega_prometida?: string | null;
  condiciones_pago?: string | null;  // 'contra_entrega' | 'anticipado' | 'credito'
  notas?: string | null;
  detalle?: OfertaDetalle | null;
  registrada_por_email: string;
  pdf_path?: string | null;
  pdf_filename?: string | null;
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

/** Sube la cotización (PDF o imagen) al bucket `ofertas-pdf` y retorna su path. */
export async function subirPdfOferta(
  ordenId: string,
  proveedorId: string,
  file: File,
): Promise<{ path: string; filename: string }> {
  if (!esAdjuntoValido(file)) throw new Error('El archivo debe ser PDF o imagen');
  if (file.size > MAX_PDF_BYTES) throw new Error('El archivo no puede superar 10 MB');

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80);
  const path = `${ordenId}/${proveedorId}-${Date.now()}-${safeName}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type || 'application/pdf', upsert: false });
  if (error) throw error;
  return { path, filename: file.name };
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
      fecha_entrega_prometida: input.fecha_entrega_prometida ?? null,
      condiciones_pago: input.condiciones_pago ?? null,
      notas: input.notas ?? null,
      detalle: limpiarDetalleOferta(input.detalle),
      registrada_por_email: input.registrada_por_email,
      pdf_path: input.pdf_path ?? null,
      pdf_filename: input.pdf_filename ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as OfertaProveedor;
}

export async function actualizarOferta(
  id: string,
  patch: Partial<Pick<CrearOfertaInput, 'precio_total' | 'fecha_entrega_prometida' | 'condiciones_pago' | 'notas'>>
): Promise<OfertaProveedor> {
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
 * Acepta una oferta:
 *  - marca esta oferta como `aceptada`,
 *  - marca las demás de la misma orden como `descartada`,
 *  - retorna la oferta aceptada actualizada.
 * No actualiza la orden — eso lo hace el caller (`pedidos.repository.aprobarOrdenConOferta`).
 */
export async function aceptarOferta(
  ofertaId: string,
  decididaPorEmail: string,
  scoreCalculado?: number | null
): Promise<OfertaProveedor> {
  const { data: oferta, error: fetchErr } = await supabase
    .from(TABLE)
    .select('orden_id')
    .eq('id', ofertaId)
    .single();
  if (fetchErr || !oferta) throw fetchErr ?? new Error('Oferta no encontrada');

  // Descartar todas las hermanas que no sean esta.
  const { error: discardErr } = await supabase
    .from(TABLE)
    .update({
      estado: 'descartada',
      decidida_por_email: decididaPorEmail,
      decidida_en: new Date().toISOString(),
    })
    .eq('orden_id', oferta.orden_id)
    .neq('id', ofertaId)
    .eq('estado', 'pendiente');
  if (discardErr) throw discardErr;

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
