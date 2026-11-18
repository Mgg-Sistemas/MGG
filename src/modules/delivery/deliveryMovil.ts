/* ============================================================
   MGG · Delivery · lógica de la vista de teléfono (31/10/2026)

   Lo que no toca pantalla ni base: cuándo mandar la ubicación, cómo se
   arma el listado del motorizado (por tomar / en curso / entregados),
   los enlaces para llamar y abrir el mapa y qué mensaje corresponde a
   cada paso cuando se quiere volver a verlo.
   ============================================================ */
import {
  claveDelivery, esRetiroAlmacen, mensajeAceptado, mensajeCancelado, mensajeEntregado,
  type PedidoDelivery, type RechazoDelivery,
} from './delivery';

/* ── Ubicación ── */

export interface PuntoGps { lat: number; lng: number }
export interface EnvioGps extends PuntoGps { t: number }

/** Cada cuánto, como máximo, se manda la ubicación sin moverse mucho. */
export const UBICACION_CADA_MS = 30_000;
/** Moverse más que esto manda la ubicación aunque no hayan pasado los 30 s. */
export const UBICACION_METROS = 50;
/** Ni moviéndose se manda más seguido que esto (el GPS a veces dispara varias lecturas juntas). */
export const UBICACION_MIN_MS = 5_000;

/** Distancia en metros entre dos puntos (fórmula del haversine). */
export function distanciaMetros(a: PuntoGps, b: PuntoGps): number {
  const R = 6_371_000;
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * ¿Se manda esta lectura? La primera siempre; después, cuando pasaron 30 s
 * desde el último envío o cuando se movió más de 50 m (pero nunca dos envíos
 * con menos de 5 s entre sí).
 */
export function debeEnviarUbicacion(ultimo: EnvioGps | null, ahora: EnvioGps): boolean {
  if (!ultimo) return true;
  const dt = ahora.t - ultimo.t;
  if (dt < UBICACION_MIN_MS) return false;
  if (dt >= UBICACION_CADA_MS) return true;
  return distanciaMetros(ultimo, ahora) > UBICACION_METROS;
}

/** Texto para el error del GPS (códigos de GeolocationPositionError). */
export function errorUbicacion(code: number | null | undefined): string {
  if (code === 1) {
    return 'El teléfono no le dio permiso de ubicación a esta página. Toca el candado (o los tres puntos) junto a la dirección, '
      + 'entra en «Permisos» › «Ubicación» › «Permitir» y vuelve a cargar la página. Revisa también que la ubicación (GPS) del teléfono esté encendida.';
  }
  if (code === 2) return 'No hay señal de GPS. Enciende la ubicación del teléfono o sal a un lugar abierto.';
  if (code === 3) return 'El GPS está tardando en responder. Se sigue intentando.';
  return 'No se pudo leer la ubicación de este teléfono.';
}

/* ── Enlaces ── */

/** Enlace `tel:` con solo dígitos (y el + inicial). `null` si no parece un teléfono. */
export function telHref(telefono: string | null | undefined): string | null {
  const t = String(telefono ?? '').trim();
  const limpio = t.replace(/(?!^\+)[^\d]/g, '');
  return limpio.replace(/\D/g, '').length >= 7 ? `tel:${limpio}` : null;
}

/** Abre la dirección en el mapa del teléfono (Google Maps). */
export function mapaHref(direccion: string | null | undefined): string | null {
  const d = String(direccion ?? '').trim();
  return d ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(d)}` : null;
}

/* ── Listado ── */

export type ChipDelivery = 'todos' | 'por_tomar' | 'en_ruta' | 'entregados';

export interface PedidoFeed {
  p: PedidoDelivery;
  /** Se puede tomar: por tomar, o cancelado por otro y libre otra vez. */
  disponible: boolean;
}

/** Cuántos entregados se muestran en el teléfono (el histórico completo está en la PC). */
export const MAX_ENTREGADOS_TELEFONO = 30;

const t = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() || 0 : 0);

/** 02/11/2026: claves (orden + origen) de lo que ESTE motorizado marcó «No disponible». */
export function rechazadosPor(rechazos: Pick<RechazoDelivery, 'orden_id' | 'origen' | 'repartidor_id'>[], uid: string | null | undefined): Set<string> {
  return new Set(uid ? rechazos.filter((r) => r.repartidor_id === uid).map((r) => claveDelivery(r)) : []);
}

/**
 * Junta la lista de activos (`listPedidosDelivery(false)`) con la de cerrados
 * (`listPedidosDelivery(true)`). En la de activos una fila «cancelado» solo
 * puede estar porque el pedido quedó libre otra vez: ese se puede tomar.
 * Orden: lo mío en curso, lo que está por tomar (urgente primero, como lo
 * manda la base) y mis entregados más nuevos.
 * 02/11/2026 (pedido de la usuaria): un pedido aceptado SOLO lo ve quien lo
 * aceptó (lo de otros en curso o entregado no sale en el teléfono; la PC lo
 * ve todo) y lo que yo marqué «No disponible» ya no me sale en «Por tomar».
 * Cada fila es (orden, origen): la misma SP puede traer su retiro de Almacén
 * y su OC.
 */
export function armarFeed(activos: PedidoDelivery[], conCerrados: PedidoDelivery[], rechazadosPorMi: Set<string> = new Set()): PedidoFeed[] {
  const vistos = new Set<string>();
  const mios: PedidoFeed[] = [];
  const libres: PedidoFeed[] = [];
  for (const p of activos) {
    const k = claveDelivery(p);
    vistos.add(k);
    if (p.estado === 'por_tomar' || p.estado === 'cancelado') {
      if (!rechazadosPorMi.has(k)) libres.push({ p, disponible: true });
    } else if (p.es_mio) mios.push({ p, disponible: false });
  }
  mios.sort((a, b) => (a.p.estado === 'en_ruta' ? 0 : 1) - (b.p.estado === 'en_ruta' ? 0 : 1));
  const entregados = conCerrados
    .filter((p) => !vistos.has(claveDelivery(p)) && p.estado === 'entregado' && p.es_mio)
    .sort((a, b) => t(b.entregado_en) - t(a.entregado_en))
    .slice(0, MAX_ENTREGADOS_TELEFONO)
    .map((p) => ({ p, disponible: false }));
  return [...mios, ...libres, ...entregados];
}

export function enChip(f: PedidoFeed, chip: ChipDelivery): boolean {
  if (chip === 'todos') return true;
  if (chip === 'por_tomar') return f.disponible;
  if (chip === 'en_ruta') return !f.disponible && (f.p.estado === 'aceptado' || f.p.estado === 'en_ruta');
  return f.p.estado === 'entregado';
}

/** 10/11/2026 (maqueta): color de la franja de la tarjeta según el estado. */
export type EstadoTarjeta = 'por_tomar' | 'en_camino' | 'entregado' | 'cancelado';
export function estadoTarjeta(f: PedidoFeed): EstadoTarjeta {
  if (f.disponible) return 'por_tomar';
  if (f.p.estado === 'aceptado' || f.p.estado === 'en_ruta') return 'en_camino';
  return f.p.estado === 'entregado' ? 'entregado' : 'cancelado';
}

/** 10/11/2026: en qué tramo va (1 = va a buscarlo, 2 = ya lo recogió y va a entregarlo). */
export function tramoEnCurso(p: Pick<PedidoDelivery, 'fotos_recibo'>): 1 | 2 {
  return (p.fotos_recibo?.length ?? 0) > 0 ? 2 : 1;
}

/** ¿El pedido fue previamente cancelado/desasignado antes de quedar libre para re-toma? */
export function fueCanceladoPreviamente(p: Pick<PedidoDelivery, 'estado' | 'motivo_cancel'>): boolean {
  return p.estado === 'cancelado' || !!p.motivo_cancel;
}

/** El pedido que este motorizado tiene en curso (en ruta primero). */
export function trabajoEnCurso(feed: PedidoFeed[]): PedidoDelivery | null {
  const mios = feed.filter((f) => !f.disponible && f.p.es_mio && (f.p.estado === 'aceptado' || f.p.estado === 'en_ruta'));
  return (mios.find((f) => f.p.estado === 'en_ruta') ?? mios[0])?.p ?? null;
}

/** 02/11/2026: la tarjeta muestra solo cuántos productos trae: «📦 1 producto» / «📦 17 productos». */
export function productosTxt(n: number): string {
  const k = Math.max(0, Math.trunc(Number(n) || 0));
  return `📦 ${k} ${k === 1 ? 'producto' : 'productos'}`;
}

/* ── Mensajes ── */

/** El mensaje del paso en que está el pedido, con las horas guardadas (para volver a verlo). */
export function mensajeDeEstado(
  p: PedidoDelivery, nombre: string, verAlmacen: (a: string) => string = (a) => a,
): { titulo: string; texto: string } | null {
  const quien = p.repartidor_nombre?.trim() || nombre;
  const retiro = esRetiroAlmacen(p);
  switch (p.estado) {
    case 'aceptado': return { titulo: retiro ? 'Retiro aceptado' : 'Pedido aceptado', texto: mensajeAceptado(p, quien, p.aceptado_en) };
    // 02/11/2026: al aceptar queda «En camino»: se muestra el mensaje de la aceptación.
    case 'en_ruta': return { titulo: 'En camino', texto: mensajeAceptado(p, quien, p.en_ruta_en ?? p.aceptado_en) };
    case 'entregado': return retiro ? {
      titulo: 'Retiro entregado',
      texto: mensajeEntregado(p, quien, (p.almacen_entrega ?? '').trim() || '—', p.nota_entrega, p.entregado_en),
    } : {
      titulo: 'Entregado en almacén',
      texto: mensajeEntregado(p, quien, verAlmacen(p.almacen_entrega ?? p.almacen_destino ?? '—'), p.nota_entrega, p.entregado_en),
    };
    case 'cancelado': return {
      titulo: retiro ? 'Retiro cancelado' : 'Pedido cancelado',
      texto: mensajeCancelado(p, quien, p.motivo_cancel ?? '—', p.detalle_cancel, p.cancelado_en),
    };
    default: return null;
  }
}
