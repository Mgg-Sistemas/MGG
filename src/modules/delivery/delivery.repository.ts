/* ============================================================
   MGG · Delivery · acceso a datos (31/10/2026)
   Todo pasa por las funciones de Supabase en supabase/sql/delivery/:
   la base decide quién puede tomar (solo uno por OC), avanzar y subir fotos.
   ============================================================ */
import { useEffect, useState } from 'react';
import { supabase } from '@/shared/lib/supabase';
import { comprimirImagen } from '@/shared/lib/comprimirImagen';
import { useRealtime } from '@/shared/lib/useRealtime';
import { labelMetodoPago, urlAdjuntoOc } from '@/modules/pedidos/pedidos.repository';
import type { PagoMetodo } from '@/shared/lib/types';
import {
  INTERRUPTOR_DELIVERY, MAX_FOTOS_DELIVERY, esDelCanal, type CanalDelivery,
  type FotoDelivery, type TipoFotoDelivery, type OrigenDelivery, type TipoDelivery,
  type PedidoDelivery, type RechazoDelivery, type UbicacionDelivery,
} from './delivery';
import { puntoValido, type LugarDelivery, type PuntoMapa, type UbicacionesProveedores } from './deliveryRutas';

const BUCKET = 'delivery-fotos';

const err = (e: unknown, def: string) => new Error(e instanceof Error ? e.message : (e as { message?: string })?.message || def);

function normalizar(r: Record<string, unknown>): PedidoDelivery {
  const p = r as unknown as PedidoDelivery;
  const origen: OrigenDelivery = p.origen === 'almacen' || p.tipo === 'retiro_almacen' ? 'almacen' : 'compra';
  const tipo: TipoDelivery = origen === 'almacen' ? 'retiro_almacen' : 'oc';
  return {
    ...p,
    origen,
    tipo,
    total: Number(p.total) || 0,
    items: Array.isArray(r.items) ? (r.items as PedidoDelivery['items']) : [],
    fotos_recibo: Array.isArray(r.fotos_recibo) ? (r.fotos_recibo as FotoDelivery[]) : [],
    fotos_entrega: Array.isArray(r.fotos_entrega) ? (r.fotos_entrega as FotoDelivery[]) : [],
    fotos_factura: Array.isArray(r.fotos_factura) ? (r.fotos_factura as FotoDelivery[]) : [],
    historial: Array.isArray(r.historial) ? (r.historial as PedidoDelivery['historial']) : [],
  };
}

/** ¿Está conectado Delivery a Compras? (config compras.delivery). Apagado = el módulo abre pero no llegan OC. */
export async function deliveryConectado(): Promise<boolean> {
  const { data, error } = await supabase.rpc('delivery_conectado');
  if (error) return false;
  return data === true;
}

/** `null` mientras carga (para no mostrar el aviso de «no conectado» de entrada); se actualiza en vivo. */
export function useDeliveryConectado(): boolean | null {
  const [v, setV] = useState<boolean | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let vivo = true;
    void deliveryConectado().then((x) => { if (vivo) setV(x); });
    return () => { vivo = false; };
  }, [n]);
  useRealtime(['sistema_configuracion', 'sistema_interruptores'], () => setN((x) => x + 1));
  return v;
}

/**
 * Los pedidos: los disponibles (OC pagadas sin tomar y retiros en Almacén Los Pinos),
 * los en curso y, con `incluirCerrados`, los entregados y cancelados (histórico).
 */
export async function listPedidosDelivery(incluirCerrados = false, canal: CanalDelivery = 'delivery'): Promise<PedidoDelivery[]> {
  const { data, error } = await supabase.rpc('delivery_pedidos_listado', { p_incluir_cerrados: incluirCerrados, p_flota: canal });
  if (error) throw err(error, 'No se pudieron leer los pedidos.');
  const pedidos = ((data ?? []) as Record<string, unknown>[]).map(normalizar);

  // Intentar leer fotos de la factura si la base tiene delivery_fotos_factura
  const conPedido = Array.from(new Set(pedidos.map((p) => p.pedido_id).filter((x): x is string => !!x)));
  if (conPedido.length) {
    try {
      const { data: facs } = await supabase.rpc('delivery_fotos_factura', { p_pedido_ids: conPedido });
      if (facs && Array.isArray(facs)) {
        const porPedido = new Map((facs as Array<{ pedido_id: string; fotos_factura: unknown }>)
          .map((x) => [x.pedido_id, Array.isArray(x.fotos_factura) ? (x.fotos_factura as FotoDelivery[]) : []]));
        for (const p of pedidos) {
          if (p.pedido_id && porPedido.has(p.pedido_id)) {
            p.fotos_factura = porPedido.get(p.pedido_id) ?? [];
          }
        }
      }
    } catch {
      // Sin RPC de fotos_factura adicional, ya viene de normalizar
    }
  }

  return pedidos;
}

/**
 * Aceptar el pedido (la OC o el retiro de Almacén).
 * Si otro delivery lo aceptó primero, la base lo rechaza con su nombre.
 */
export async function tomarPedido(ordenId: string, origen: OrigenDelivery | TipoDelivery = 'compra'): Promise<void> {
  const tipo: TipoDelivery = origen === 'almacen' || origen === 'retiro_almacen' ? 'retiro_almacen' : 'oc';
  const { error } = await supabase.rpc('delivery_tomar', { p_orden_id: ordenId, p_tipo: tipo });
  if (error) throw err(error, 'No se pudo aceptar el pedido.');
}

/** 02/11/2026: «No disponible» con motivo (queda guardado; el pedido sigue libre para los demás). */
export async function rechazarPedido(ordenId: string, origen: OrigenDelivery | TipoDelivery, motivo: string): Promise<void> {
  const tipo: TipoDelivery = origen === 'almacen' || origen === 'retiro_almacen' ? 'retiro_almacen' : 'oc';
  const { error } = await supabase.rpc('delivery_no_disponible', {
    p_orden_id: ordenId, p_tipo: tipo, p_motivo: motivo, p_detalle: null,
  });
  if (error) throw err(error, 'No se pudo guardar el «No disponible».');
}

/** Alias para compatibilidad */
export const marcarNoDisponible = rechazarPedido;

/** Los «No disponible» de esas órdenes (para ocultarlos al que los marcó y mostrarlos en la PC). */
export async function listRechazosDelivery(ordenIds: string[]): Promise<RechazoDelivery[]> {
  const ids = [...new Set(ordenIds)].filter(Boolean);
  if (!ids.length) return [];
  const { data, error } = await supabase.from('delivery_rechazos')
    .select('id, orden_id, origen, repartidor_id, repartidor_email, repartidor_nombre, motivo, created_at')
    .in('orden_id', ids).order('created_at', { ascending: false });
  if (error) return [];
  return ((data ?? []) as RechazoDelivery[]).map((r) => ({ ...r, origen: r.origen === 'almacen' ? 'almacen' : 'compra' }));
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

/** Sube fotos (comprimidas) al recibir del proveedor ('recibo'), al entregar ('entrega') o factura ('factura'). */
export async function subirFotosDelivery(
  pedidoId: string, tipo: TipoFotoDelivery, actuales: FotoDelivery[], archivos: File[],
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
 * 03/11/2026 · Editar las fotos de un pedido YA ENTREGADO:
 * sube las nuevas (comprimidas), anota la lista final con `delivery_editar_fotos` y
 * borra del bucket los archivos quitados.
 */
export async function editarFotosDelivery(
  pedidoId: string, tipo: TipoFotoDelivery, quedan: FotoDelivery[], nuevos: File[], quitadas: FotoDelivery[],
): Promise<{ fotos: FotoDelivery[]; sinBorrar: number }> {
  if (quedan.length + nuevos.length > MAX_FOTOS_DELIVERY) throw new Error(`Se pueden adjuntar hasta ${MAX_FOTOS_DELIVERY} fotos.`);
  const subidas = await Promise.all(nuevos.map(async (original) => {
    const f = await comprimirImagen(original).catch(() => original);
    const path = `${pedidoId}/${tipo}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${seguro(f.name)}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, f, { upsert: false, contentType: f.type || 'image/jpeg' });
    if (error) throw new Error(`No se pudo subir «${original.name}»: ${error.message}`);
    return { path, filename: original.name };
  }));
  const fotos = [...quedan, ...subidas];
  const { error } = await supabase.rpc('delivery_editar_fotos', { p_pedido_id: pedidoId, p_tipo: tipo, p_fotos: fotos });
  if (error) {
    if (subidas.length) await supabase.storage.from(BUCKET).remove(subidas.map((s) => s.path)).catch(() => {});
    throw err(error, 'No se pudieron guardar las fotos.');
  }
  let sinBorrar = 0;
  if (quitadas.length) {
    const { data, error: e2 } = await supabase.storage.from(BUCKET).remove(quitadas.map((q) => q.path));
    sinBorrar = e2 ? quitadas.length : Math.max(0, quitadas.length - (data?.length ?? 0));
  }
  return { fotos, sinBorrar };
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

export async function listUbicaciones(canal: CanalDelivery = 'delivery'): Promise<UbicacionDelivery[]> {
  const { data, error } = await supabase.from('delivery_ubicaciones').select('*').eq('flota', canal).order('actualizado_en', { ascending: false });
  if (error) throw err(error, 'No se pudieron leer las ubicaciones.');
  return ((data ?? []) as UbicacionDelivery[]).map((u) => ({ ...u, lat: Number(u.lat), lng: Number(u.lng) }));
}

/* ───────────── Mapa, rutas y lugares ───────────── */

export async function listUbicacionesProveedores(ids: (string | null | undefined)[]): Promise<UbicacionesProveedores> {
  const unicos = [...new Set(ids.filter((x): x is string => !!x))];
  const out: UbicacionesProveedores = new Map();
  if (!unicos.length) return out;
  const { data, error } = await supabase.from('proveedores').select('id, lat, lng').in('id', unicos).not('lat', 'is', null);
  if (error) throw err(error, 'No se pudieron leer las ubicaciones de los proveedores.');
  for (const r of (data ?? []) as Array<{ id: string; lat: unknown; lng: unknown }>) {
    const p = puntoValido(r.lat, r.lng);
    if (p) out.set(r.id, p);
  }
  return out;
}

export async function ubicarProveedorDesdeDelivery(proveedorId: string, punto: PuntoMapa): Promise<void> {
  const { error } = await supabase.rpc('delivery_ubicar_proveedor', { p_proveedor_id: proveedorId, p_lat: punto.lat, p_lng: punto.lng });
  if (error) throw err(error, 'No se pudo guardar la ubicación del proveedor.');
}

export async function listLugaresDelivery(): Promise<LugarDelivery[]> {
  const { data, error } = await supabase.from('delivery_lugares').select('clave, nombre, lat, lng, actualizado_en, actualizado_por');
  if (error) return [];
  return ((data ?? []) as LugarDelivery[]).map((l) => ({
    ...l, lat: l.lat == null ? null : Number(l.lat), lng: l.lng == null ? null : Number(l.lng),
  }));
}

export async function fijarLugarDelivery(clave: string, punto: PuntoMapa): Promise<void> {
  const { error } = await supabase.rpc('delivery_fijar_lugar', { p_clave: clave, p_lat: punto.lat, p_lng: punto.lng });
  if (error) throw err(error, 'No se pudo guardar el lugar.');
}

export function useUbicacionesRuta(proveedorIds: (string | null | undefined)[]): {
  provs: UbicacionesProveedores; lugares: LugarDelivery[]; recargar: () => void;
} {
  const clave = [...new Set(proveedorIds.filter(Boolean))].sort().join(',');
  const [provs, setProvs] = useState<UbicacionesProveedores>(() => new Map());
  const [lugares, setLugares] = useState<LugarDelivery[]>([]);
  const [n, setN] = useState(0);
  useEffect(() => {
    let vivo = true;
    void listUbicacionesProveedores(clave ? clave.split(',') : []).then((m) => { if (vivo) setProvs(m); }).catch(() => {});
    return () => { vivo = false; };
  }, [clave, n]);
  useEffect(() => {
    let vivo = true;
    void listLugaresDelivery().then((l) => { if (vivo) setLugares(l); }).catch(() => {});
    return () => { vivo = false; };
  }, [n]);
  useRealtime(['proveedores', 'delivery_lugares'], () => setN((x) => x + 1));
  return { provs, lugares, recargar: () => setN((x) => x + 1) };
}

export interface PuntoRastro { pedido_id: string; lat: number; lng: number; en: string }

export async function listRastroDelivery(pedidoIds: (string | null | undefined)[]): Promise<Map<string, PuntoRastro[]>> {
  const ids = [...new Set(pedidoIds.filter((x): x is string => !!x))];
  const out = new Map<string, PuntoRastro[]>();
  if (!ids.length) return out;
  const { data, error } = await supabase.from('delivery_rastro').select('pedido_id, lat, lng, en')
    .in('pedido_id', ids).order('en', { ascending: true }).limit(2000);
  if (error) return out;
  for (const r of (data ?? []) as PuntoRastro[]) {
    const lista = out.get(r.pedido_id) ?? [];
    lista.push({ ...r, lat: Number(r.lat), lng: Number(r.lng) });
    out.set(r.pedido_id, lista);
  }
  return out;
}

/* ───────────── Histórico y reportes ───────────── */

export interface FilaHistorialCruda {
  id: string;
  orden_id: string;
  origen: OrigenDelivery;
  estado: string;
  repartidor_nombre: string | null;
  repartidor_email: string | null;
  aceptado_en: string;
  en_ruta_en: string | null;
  entregado_en: string | null;
  cancelado_en: string | null;
  motivo_cancel: string | null;
  almacen_entrega: string | null;
  nota_entrega: string | null;
  fotos_recibo: FotoDelivery[];
  fotos_entrega: FotoDelivery[];
  orden: {
    oc_codigo: string | null; codigo: string; total: number; moneda: string | null; proveedor_id: string | null;
    unidad_solicitante?: string | null; solicitante?: string | null; recibida_en?: string | null;
    modalidad_entrega?: string | null;
  } | null;
}

export async function listHistorialDelivery(desde: string, hasta: string, canal: CanalDelivery = 'delivery'): Promise<FilaHistorialCruda[]> {
  const { data, error } = await supabase.from('delivery_pedidos')
    .select('id, orden_id, origen, estado, repartidor_nombre, repartidor_email, aceptado_en, en_ruta_en, entregado_en, cancelado_en, motivo_cancel, almacen_entrega, nota_entrega, fotos_recibo, fotos_entrega, orden:ordenes(oc_codigo, codigo, total, moneda, proveedor_id, unidad_solicitante, solicitante, recibida_en, modalidad_entrega)')
    .gte('aceptado_en', `${desde}T00:00:00-04:00`).lte('aceptado_en', `${hasta}T23:59:59.999-04:00`)
    .order('aceptado_en', { ascending: false });
  if (error) throw err(error, 'No se pudo leer el histórico.');
  return ((data ?? []) as unknown as FilaHistorialCruda[])
    .filter((f) => (f.origen === 'almacen' ? canal === 'delivery' : esDelCanal(f.orden?.modalidad_entrega, canal)));
}

export interface ArchivoComprobanteDelivery { url: string; nombre: string; etiqueta: string; esPdf: boolean }

export interface ComprobantePagoDelivery {
  archivos: ArchivoComprobanteDelivery[];
  pagadaEn: string | null;
  pagos: Array<{ monto: number; moneda: string; metodo: string }>;
  total: number;
  moneda: string;
  aplica: boolean;
  mensaje: string | null;
}

export async function comprobantePagoDelivery(ordenId: string): Promise<ComprobantePagoDelivery> {
  const { data: orden, error } = await supabase
    .from('ordenes')
    .select('id, oc_codigo, estado, pagada_en, total, moneda, metodo_pago, historial, factura_path, factura_nombre')
    .eq('id', ordenId)
    .single();
  if (error || !orden) throw err(error, 'No se pudo leer la orden.');
  if (orden.estado !== 'pagada' && !orden.pagada_en) {
    return { archivos: [], pagadaEn: null, pagos: [], total: 0, moneda: orden.moneda || 'USD', aplica: false, mensaje: 'La orden aún no está pagada.' };
  }

  const archivos: ArchivoComprobanteDelivery[] = [];
  const pagosHist = ((orden.historial as Array<Record<string, unknown>>) ?? []).filter((e) => e?.evento === 'pagada');
  for (const e of pagosHist) {
    if (typeof e.comprobante_path === 'string' && e.comprobante_path) {
      const url = await urlAdjuntoOc(e.comprobante_path).catch(() => '');
      if (url) {
        const nombre = typeof e.comprobante_nombre === 'string' ? e.comprobante_nombre : 'Comprobante';
        archivos.push({ url, nombre, etiqueta: 'Comprobante de pago', esPdf: /\.pdf$/i.test(e.comprobante_path) });
      }
    }
  }

  if (!archivos.length && orden.factura_path) {
    const url = await urlAdjuntoOc(orden.factura_path).catch(() => '');
    if (url) {
      const nombre = orden.factura_nombre || 'Comprobante';
      archivos.push({ url, nombre, etiqueta: 'Comprobante de pago', esPdf: /\.pdf$/i.test(orden.factura_path) });
    }
  }

  const pagos = (Array.isArray(orden.metodo_pago) ? (orden.metodo_pago as PagoMetodo[]) : [])
    .map((p) => ({ monto: Number(p?.monto) || 0, moneda: p?.moneda ?? '', metodo: labelMetodoPago(p?.metodo) }));

  return {
    archivos,
    pagadaEn: orden.pagada_en ?? null,
    pagos,
    total: Number(orden.total) || 0,
    moneda: orden.moneda || 'USD',
    aplica: true,
    mensaje: null,
  };
}
