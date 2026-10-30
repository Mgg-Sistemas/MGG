/* ============================================================
   MGG · Delivery · acceso a datos (30-10-2026)
   Todo pasa por las funciones de supabase/sql/delivery-2026-10-30.sql:
   la base decide quién puede tomar (solo uno por OC), avanzar y subir fotos.
   ============================================================ */
import { useEffect, useState } from 'react';
import { supabase } from '@/shared/lib/supabase';
import { comprimirImagen } from '@/shared/lib/comprimirImagen';
import type { Orden } from '@/shared/lib/types';
import { elegirComprobanteTesoreria } from '@/modules/pedidos/comprobanteTesoreria';
import { MAX_FOTOS_DELIVERY, type FotoDelivery, type PedidoDelivery, type UbicacionDelivery } from './delivery';

const BUCKET = 'delivery-fotos';

function err(e: { message?: string } | null | unknown, porDefecto: string): Error {
  const m = String((e as { message?: string } | null)?.message ?? '').trim();
  if (/permission denied|row-level security/i.test(m)) return new Error('No tienes permiso en Delivery.');
  return new Error(m || porDefecto);
}

function normalizar(r: Record<string, unknown>): PedidoDelivery {
  const p = r as unknown as PedidoDelivery;
  return {
    ...p,
    total: Number(p.total) || 0,
    items: Array.isArray(r.items) ? (r.items as PedidoDelivery['items']) : [],
    fotos_recibo: Array.isArray(r.fotos_recibo) ? (r.fotos_recibo as FotoDelivery[]) : [],
    fotos_entrega: Array.isArray(r.fotos_entrega) ? (r.fotos_entrega as FotoDelivery[]) : [],
    historial: Array.isArray(r.historial) ? (r.historial as PedidoDelivery['historial']) : [],
  };
}

/** ¿Está conectado Delivery a Compras? (config compras.delivery). Apagado = el módulo abre pero no llegan OC. */
export async function deliveryConectado(): Promise<boolean> {
  const { data, error } = await supabase.rpc('delivery_conectado');
  if (error) return false;
  return data === true;
}

export function useDeliveryConectado(): boolean | null {
  const [v, setV] = useState<boolean | null>(null);
  useEffect(() => {
    let vivo = true;
    void deliveryConectado().then((x) => { if (vivo) setV(x); });
    return () => { vivo = false; };
  }, []);
  return v;
}

/**
 * Los pedidos: los disponibles (OC pagadas y retenidas sin tomar), los en curso y,
 * con `incluirCerrados`, los entregados y cancelados (histórico).
 */
export async function listPedidosDelivery(incluirCerrados = false): Promise<PedidoDelivery[]> {
  const { data, error } = await supabase.rpc('delivery_pedidos_listado', { p_incluir_cerrados: incluirCerrados });
  if (error) throw err(error, 'No se pudieron leer los pedidos.');
  return ((data ?? []) as Record<string, unknown>[]).map(normalizar);
}

/** Tomar el pedido. Si otro delivery lo tomó primero, la base lo rechaza con su nombre. */
export async function tomarPedido(ordenId: string): Promise<void> {
  const { error } = await supabase.rpc('delivery_tomar', { p_orden_id: ordenId });
  if (error) throw err(error, 'No se pudo tomar el pedido.');
}

export async function marcarEnRuta(pedidoId: string): Promise<void> {
  const { error } = await supabase.rpc('delivery_avanzar', { p_pedido_id: pedidoId, p_estado: 'en_ruta' });
  if (error) throw err(error, 'No se pudo marcar en ruta.');
}

export async function marcarEntregado(pedidoId: string, almacen: string, nota?: string | null): Promise<void> {
  const { error } = await supabase.rpc('delivery_avanzar', {
    p_pedido_id: pedidoId, p_estado: 'entregado', p_almacen: almacen, p_nota: nota ?? null,
  });
  if (error) throw err(error, 'No se pudo marcar la entrega.');
}

export async function cancelarPedido(pedidoId: string, motivo: string, detalle?: string | null): Promise<void> {
  const { error } = await supabase.rpc('delivery_avanzar', {
    p_pedido_id: pedidoId, p_estado: 'cancelado', p_motivo: motivo, p_detalle: detalle ?? null,
  });
  if (error) throw err(error, 'No se pudo cancelar el pedido.');
}

const seguro = (n: string) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').slice(-80);

/** Sube fotos (comprimidas) al recibir del proveedor ('recibo') o al entregar ('entrega'). */
export async function subirFotosDelivery(
  pedidoId: string, tipo: 'recibo' | 'entrega', actuales: FotoDelivery[], archivos: File[],
): Promise<FotoDelivery[]> {
  if (actuales.length + archivos.length > MAX_FOTOS_DELIVERY) throw new Error(`Se pueden adjuntar hasta ${MAX_FOTOS_DELIVERY} fotos.`);
  const nuevas = await Promise.all(archivos.map(async (original) => {
    const f = await comprimirImagen(original).catch(() => original);
    const path = `${pedidoId}/${tipo}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${seguro(f.name)}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, f, { upsert: false, contentType: f.type || 'image/jpeg' });
    if (error) throw new Error(`No se pudo subir «${original.name}»: ${error.message}`);
    return { path, filename: original.name };
  }));
  const fotos = [...actuales, ...nuevas];
  const { error } = await supabase.rpc('delivery_fotos', { p_pedido_id: pedidoId, p_tipo: tipo, p_fotos: fotos });
  if (error) throw err(error, 'No se pudieron anotar las fotos.');
  return fotos;
}

export async function urlFotoDelivery(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 10);
  if (error) throw new Error('No se pudo abrir la foto.');
  return data.signedUrl;
}

/** El motorizado comparte dónde está (se llama al cambiar la posición, con límite de frecuencia). */
export async function compartirUbicacion(
  pos: { lat: number; lng: number; precision?: number | null; velocidad?: number | null; rumbo?: number | null },
  pedidoId?: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('delivery_ubicar', {
    p_lat: pos.lat, p_lng: pos.lng, p_precision: pos.precision ?? null,
    p_velocidad: pos.velocidad ?? null, p_rumbo: pos.rumbo ?? null, p_pedido_id: pedidoId ?? null,
  });
  if (error) throw err(error, 'No se pudo compartir la ubicación.');
}

export async function listUbicaciones(): Promise<UbicacionDelivery[]> {
  const { data, error } = await supabase.from('delivery_ubicaciones').select('*').order('actualizado_en', { ascending: false });
  if (error) throw err(error, 'No se pudieron leer las ubicaciones.');
  return (data ?? []) as UbicacionDelivery[];
}

/** Histórico directo de la tabla (incluye cada cancelación aunque la OC se haya retomado). */
export async function listHistorialDelivery(desde: string, hasta: string): Promise<Array<{
  id: string; orden_id: string; estado: string; repartidor_nombre: string | null; repartidor_email: string | null;
  aceptado_en: string; en_ruta_en: string | null; entregado_en: string | null; cancelado_en: string | null;
  motivo_cancel: string | null; almacen_entrega: string | null;
  orden: { oc_codigo: string | null; codigo: string; total: number; moneda: string | null; proveedor_id: string | null } | null;
}>> {
  const { data, error } = await supabase.from('delivery_pedidos')
    .select('id, orden_id, estado, repartidor_nombre, repartidor_email, aceptado_en, en_ruta_en, entregado_en, cancelado_en, motivo_cancel, almacen_entrega, orden:ordenes(oc_codigo, codigo, total, moneda, proveedor_id)')
    .gte('aceptado_en', `${desde}T00:00:00-04:00`).lte('aceptado_en', `${hasta}T23:59:59-04:00`)
    .order('aceptado_en', { ascending: false });
  if (error) throw err(error, 'No se pudo leer el histórico.');
  return (data ?? []) as never;
}

export interface ComprobantePagoDelivery {
  url: string;
  nombre: string;
  esPdf: boolean;
  pagadaEn: string | null;
  pagos: Array<{ monto: number; moneda: string }>;
}

/**
 * El comprobante que adjuntó Tesorería al pagar la OC, para que el delivery verifique
 * que de verdad se pagó. Misma regla que Compras (elegirComprobanteTesoreria);
 * null si Tesorería no adjuntó nada (p. ej. efectivo).
 */
export async function comprobantePagoDelivery(ordenId: string): Promise<ComprobantePagoDelivery | null> {
  const { data, error } = await supabase.rpc('delivery_comprobante_pago', { p_orden_id: ordenId });
  if (error) throw err(error, 'No se pudo leer el pago de la orden.');
  const o = data as { id: string; pagada_en: string | null; historial: Array<Record<string, unknown>> };
  const historial = (o.historial ?? []) as unknown as NonNullable<Orden['historial']>;
  let ref = elegirComprobanteTesoreria({ id: o.id, pagada_en: o.pagada_en, historial });
  if (!ref) {
    const { data: archivos } = await supabase.storage.from('compras-oc').list(o.id, { limit: 100 });
    ref = elegirComprobanteTesoreria({ id: o.id, pagada_en: o.pagada_en, historial },
      (archivos ?? []).map((f) => ({ name: f.name, created_at: f.created_at })));
  }
  if (!ref) return null;
  const { data: firmada, error: e2 } = await supabase.storage.from('compras-oc').createSignedUrl(ref.path, 60 * 10);
  if (e2) throw new Error('No se pudo abrir el comprobante de pago.');
  const ultimo = (o.historial ?? []).at(-1);
  const pagos = Array.isArray(ultimo?.multipago)
    ? (ultimo.multipago as Array<{ monto?: number; moneda?: string }>).map((p) => ({ monto: Number(p.monto) || 0, moneda: p.moneda ?? '' }))
    : [];
  return { url: firmada.signedUrl, nombre: ref.nombre, esPdf: /\.pdf$/i.test(ref.path), pagadaEn: o.pagada_en, pagos };
}
