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
import { recibirOrdenParcial } from '@/modules/pedidos/pedidos.repository';
import { todasLasFilas } from '@/shared/lib/todasLasFilas';
import { MAX_FOTOS_DELIVERY, type FotoDelivery, type PedidoDelivery, type TipoDelivery, type UbicacionDelivery } from './delivery';
import {
  claveParadas, leerDestinos, leerRutaOsrm, lineaRecta, puntoValido, urlRutaOsrm,
  type ClaveDestino, type DestinosDelivery, type Punto, type Ruta,
} from './deliveryRutas';

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
    tipo: p.tipo === 'retiro_almacen' ? 'retiro_almacen' : 'oc',
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
 * Los pedidos: los disponibles (OC pagadas sin tomar; la retención no es requisito; y, desde el 02-11,
 * los retiros en Los Pinos de las SP que almacén atiende), los en curso y,
 * con `incluirCerrados`, los entregados y cancelados (histórico).
 */
export async function listPedidosDelivery(incluirCerrados = false): Promise<PedidoDelivery[]> {
  const { data, error } = await supabase.rpc('delivery_pedidos_listado', { p_incluir_cerrados: incluirCerrados });
  if (error) throw err(error, 'No se pudieron leer los pedidos.');
  return ((data ?? []) as Record<string, unknown>[]).map(normalizar);
}

/** Tomar el pedido (la OC, o el retiro en Los Pinos de una SP). Si otro delivery lo tomó primero, la base lo rechaza con su nombre. */
export async function tomarPedido(ordenId: string, tipo: TipoDelivery = 'oc'): Promise<void> {
  const { error } = await supabase.rpc('delivery_tomar', { p_orden_id: ordenId, p_tipo: tipo });
  if (error) throw err(error, 'No se pudo tomar el pedido.');
}

export async function marcarEnRuta(pedidoId: string): Promise<void> {
  const { error } = await supabase.rpc('delivery_avanzar', { p_pedido_id: pedidoId, p_estado: 'en_ruta' });
  if (error) throw err(error, 'No se pudo marcar en ruta.');
}

/**
 * El delivery entregó la OC en el almacén (02-11-2026, regla de la administradora): la
 * orden queda RECIBIDA en inventario en ese almacén, con todo lo comprado, igual que
 * cuando Compras la recibe (mismo motor: costo, PMP, kardex, existencias). Lee la orden
 * fresca; si Compras ya la recibió, no hace nada. Devuelve 'recibida' | 'ya_recibida'.
 */
export async function recibirOcEntregada(
  ordenId: string, almacen: string, nota: string | null, actorEmail: string, actorName: string | null,
): Promise<'recibida' | 'ya_recibida'> {
  const { data, error } = await supabase.from('ordenes').select('*').eq('id', ordenId).single();
  if (error) throw err(error, 'No se pudo leer la orden.');
  const o = data as Orden;
  if (o.recibida_en) return 'ya_recibida';
  const recepciones = (o.items ?? [])
    .map((it) => ({ sku: it.sku, cantidad_recibida: Math.max(0, Number(it.cantidad) || 0) }))
    .filter((r) => r.cantidad_recibida > 0);
  const notaRec = ['Recibida por Delivery al entregar en almacén.', nota?.trim()].filter(Boolean).join(' ');
  await recibirOrdenParcial(o, recepciones, notaRec, actorEmail, actorName, almacen);
  return 'recibida';
}

export async function marcarEntregado(pedidoId: string, almacen: string, nota?: string | null): Promise<void> {
  const { error } = await supabase.rpc('delivery_avanzar', {
    p_pedido_id: pedidoId, p_estado: 'entregado', p_almacen: almacen, p_nota: nota ?? null,
  });
  if (error) throw err(error, 'No se pudo marcar la entrega.');
}

/** El pedido por tomar no está disponible para este delivery (con motivo): queda registrado y sigue libre (02-11-2026). */
export async function marcarNoDisponible(ordenId: string, tipo: TipoDelivery, motivo: string, detalle?: string | null): Promise<void> {
  const { error } = await supabase.rpc('delivery_no_disponible', {
    p_orden_id: ordenId, p_tipo: tipo, p_motivo: motivo, p_detalle: detalle ?? null,
  });
  if (error) throw err(error, 'No se pudo marcar como no disponible.');
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

/**
 * Quita una foto del pedido (03-11-2026, pedido de la administradora: ya entregada la
 * orden se pueden corregir las fotos que subió el delivery). La base deja hacerlo al
 * delivery que la tomó y al supervisor, en cualquier estado. El archivo se borra del
 * bucket si se puede; si no, queda huérfano pero ya no figura en el pedido.
 */
export async function quitarFotoDelivery(
  pedidoId: string, tipo: 'recibo' | 'entrega', actuales: FotoDelivery[], path: string,
): Promise<FotoDelivery[]> {
  const fotos = actuales.filter((f) => f.path !== path);
  const { error } = await supabase.rpc('delivery_fotos', { p_pedido_id: pedidoId, p_tipo: tipo, p_fotos: fotos });
  if (error) throw err(error, 'No se pudo quitar la foto.');
  await supabase.storage.from(BUCKET).remove([path]).catch(() => null);
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
  id: string; orden_id: string; tipo?: string | null; estado: string; repartidor_nombre: string | null; repartidor_email: string | null;
  aceptado_en: string; en_ruta_en: string | null; entregado_en: string | null; cancelado_en: string | null;
  motivo_cancel: string | null; almacen_entrega: string | null;
  orden: { oc_codigo: string | null; codigo: string; total: number; moneda: string | null; proveedor_id: string | null } | null;
}>> {
  const { data, error } = await supabase.from('delivery_pedidos')
    .select('id, orden_id, tipo, estado, repartidor_nombre, repartidor_email, aceptado_en, en_ruta_en, entregado_en, cancelado_en, motivo_cancel, almacen_entrega, orden:ordenes(oc_codigo, codigo, total, moneda, proveedor_id)')
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

/* ============================================================
   Mapa y rutas (03-11-2026): proveedores ubicados, almacenes de entrega,
   ruta por calle (OSRM) y recorrido guardado de cada pedido.
   SQL: supabase/sql/delivery-mapa-rutas-2026-11-03.sql
   ============================================================ */

export interface ProveedorUbicacion {
  id: string;
  razon_social: string;
  direccion: string | null;
  estado: string | null;
  lat: number | null;
  lng: number | null;
  ubicado_en: string | null;
  ubicado_por: string | null;
}

/** Proveedores con su ubicación (todos, o solo los ids pedidos). La lectura de proveedores es abierta. */
export async function listProveedoresUbicacion(ids?: string[]): Promise<ProveedorUbicacion[]> {
  const cols = 'id, razon_social, direccion, estado, lat, lng, ubicado_en, ubicado_por';
  if (ids) {
    const unicos = [...new Set(ids.filter(Boolean))];
    if (!unicos.length) return [];
    const { data, error } = await supabase.from('proveedores').select(cols).in('id', unicos);
    if (error) throw err(error, 'No se pudieron leer los proveedores.');
    return (data ?? []) as unknown as ProveedorUbicacion[];
  }
  return todasLasFilas<ProveedorUbicacion>((d, h) => supabase.from('proveedores').select(cols)
    .order('razon_social', { ascending: true }).order('id', { ascending: true }).range(d, h) as never);
}

/** Mapa id → punto de los proveedores ubicados. */
export function puntosDeProveedores(ps: ProveedorUbicacion[]): Map<string, Punto> {
  const m = new Map<string, Punto>();
  for (const p of ps) {
    if (p.lat === null || p.lng === null) continue;
    const punto = { lat: Number(p.lat), lng: Number(p.lng) };
    if (puntoValido(punto)) m.set(p.id, punto);
  }
  return m;
}

/**
 * Marca (o quita, con null) dónde queda el proveedor. Admin, Proveedores escritura o
 * Delivery full pueden siempre; el delivery, solo uno sin ubicar de un pedido suyo en curso.
 */
export async function ubicarProveedor(proveedorId: string, punto: Punto | null): Promise<void> {
  const { error } = await supabase.rpc('delivery_ubicar_proveedor', {
    p_proveedor_id: proveedorId, p_lat: punto?.lat ?? null, p_lng: punto?.lng ?? null,
  });
  if (error) throw err(error, 'No se pudo guardar la ubicación del proveedor.');
}

/** Coordenadas de LOS PINOS y MATANZA (config delivery.destinos). Si falla, las de partida. */
export async function leerDestinosDelivery(): Promise<DestinosDelivery> {
  const { data, error } = await supabase.rpc('delivery_destinos');
  if (error) return leerDestinos(null);
  return leerDestinos(data);
}

export async function guardarDestinoDelivery(clave: ClaveDestino, punto: Punto): Promise<DestinosDelivery> {
  const { data, error } = await supabase.rpc('delivery_destino_guardar', { p_clave: clave, p_lat: punto.lat, p_lng: punto.lng });
  if (error) throw err(error, 'No se pudo guardar la ubicación del almacén.');
  return leerDestinos(data);
}

/** Los almacenes de entrega; el segundo valor permite actualizarlos al guardar uno. */
export function useDestinosDelivery(): [DestinosDelivery, (d: DestinosDelivery) => void] {
  const [d, setD] = useState<DestinosDelivery>(() => leerDestinos(null));
  useEffect(() => {
    let vivo = true;
    void leerDestinosDelivery().then((x) => { if (vivo) setD(x); });
    return () => { vivo = false; };
  }, []);
  return [d, setD];
}

/* ── Ruta por calle ── */

const cacheRutas = new Map<string, Ruta>();
const TIEMPO_OSRM_MS = 8_000;

/**
 * Ruta en carro entre los puntos (OSRM, servidor público). Si no responde o no
 * encuentra ruta, devuelve la línea recta entre las paradas (esa no se guarda, para
 * reintentar). Las buenas se guardan en memoria por coordenadas redondeadas (~11 m).
 */
export async function calcularRuta(puntos: Punto[]): Promise<Ruta | null> {
  const validos = puntos.filter((p) => puntoValido(p));
  if (validos.length < 2) return null;
  const clave = claveParadas(validos);
  const ya = cacheRutas.get(clave);
  if (ya) return ya;
  let ruta: Ruta | null = null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIEMPO_OSRM_MS);
  try {
    const r = await fetch(urlRutaOsrm(validos), { signal: ctrl.signal });
    if (r.ok) ruta = leerRutaOsrm(await r.json());
  } catch { /* sin red o servidor caído: línea recta */ } finally { clearTimeout(t); }
  if (!ruta) return lineaRecta(validos);
  if (cacheRutas.size > 200) cacheRutas.clear();
  cacheRutas.set(clave, ruta);
  return ruta;
}

/* ── Detalle de pedidos y recorrido guardado ── */

export interface PedidoDetalleDelivery {
  id: string;
  orden_id: string;
  tipo: TipoDelivery;
  estado: string;
  repartidor_id: string;
  repartidor_nombre: string | null;
  repartidor_email: string | null;
  aceptado_en: string;
  en_ruta_en: string | null;
  entregado_en: string | null;
  cancelado_en: string | null;
  motivo_cancel: string | null;
  detalle_cancel: string | null;
  almacen_entrega: string | null;
  nota_entrega: string | null;
  fotos_recibo: FotoDelivery[];
  fotos_entrega: FotoDelivery[];
  historial: PedidoDelivery['historial'];
  orden: {
    oc_codigo: string | null; codigo: string; total: number; moneda: string | null; proveedor_id: string | null;
    almacen_destino: string | null; sede_destino: string | null;
    items: Array<{ nombre: string; cantidad: number; unidad?: string | null; comprar?: boolean; almacen_origenes?: Record<string, unknown> | null }> | null;
  } | null;
}

/** Los pedidos completos (con la orden, sus renglones y fotos) para el detalle de un delivery. */
export async function detallePedidosDelivery(ids: string[]): Promise<PedidoDetalleDelivery[]> {
  const unicos = [...new Set(ids.filter(Boolean))];
  const out: PedidoDetalleDelivery[] = [];
  for (let i = 0; i < unicos.length; i += 150) {
    const { data, error } = await supabase.from('delivery_pedidos')
      .select('id, orden_id, tipo, estado, repartidor_id, repartidor_nombre, repartidor_email, aceptado_en, en_ruta_en, entregado_en, cancelado_en, motivo_cancel, detalle_cancel, almacen_entrega, nota_entrega, fotos_recibo, fotos_entrega, historial, orden:ordenes(oc_codigo, codigo, total, moneda, proveedor_id, almacen_destino, sede_destino, items)')
      .in('id', unicos.slice(i, i + 150));
    if (error) throw err(error, 'No se pudo leer el detalle de los pedidos.');
    for (const r of (data ?? []) as unknown as Record<string, unknown>[]) {
      const x = r as unknown as PedidoDetalleDelivery;
      out.push({
        ...x,
        tipo: x.tipo === 'retiro_almacen' ? 'retiro_almacen' : 'oc',
        fotos_recibo: Array.isArray(r.fotos_recibo) ? (r.fotos_recibo as FotoDelivery[]) : [],
        fotos_entrega: Array.isArray(r.fotos_entrega) ? (r.fotos_entrega as FotoDelivery[]) : [],
        historial: Array.isArray(r.historial) ? (r.historial as PedidoDelivery['historial']) : [],
      });
    }
  }
  return out.sort((a, b) => String(b.aceptado_en).localeCompare(String(a.aceptado_en)));
}

export interface PuntoRecorrido extends Punto { pedido_id: string; t: string }

/**
 * Recorrido guardado (una muestra cada ~60 s mientras iba en curso). Si la tabla
 * todavía no existe o no hay permiso, vuelve vacío y el mapa dibuja solo la ruta planeada.
 */
export async function recorridoPedidos(pedidoIds: string[]): Promise<Map<string, PuntoRecorrido[]>> {
  const m = new Map<string, PuntoRecorrido[]>();
  const unicos = [...new Set(pedidoIds.filter(Boolean))];
  for (let i = 0; i < unicos.length; i += 100) {
    try {
      const filas = await todasLasFilas<{ pedido_id: string; lat: number; lng: number; registrado_en: string }>((d, h) => supabase
        .from('delivery_ubicaciones_hist').select('pedido_id, lat, lng, registrado_en')
        .in('pedido_id', unicos.slice(i, i + 100))
        .order('registrado_en', { ascending: true }).order('id', { ascending: true }).range(d, h) as never);
      for (const f of filas) {
        const p = { pedido_id: f.pedido_id, lat: Number(f.lat), lng: Number(f.lng), t: f.registrado_en };
        if (!puntoValido(p)) continue;
        const l = m.get(f.pedido_id) ?? [];
        l.push(p);
        m.set(f.pedido_id, l);
      }
    } catch { /* sin recorrido guardado */ }
  }
  return m;
}
