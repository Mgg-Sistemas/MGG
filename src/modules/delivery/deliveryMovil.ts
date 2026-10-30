/* ============================================================
   MGG · Delivery · lógica de la vista de teléfono (30-10-2026)

   Lo que no toca pantalla ni base: cuándo mandar la ubicación, cómo se
   arma el listado del motorizado (por tomar / en curso / entregados),
   los enlaces para llamar y abrir el mapa y qué mensaje corresponde a
   cada paso cuando se quiere volver a verlo.
   ============================================================ */
import {
  mensajeAceptado, mensajeCancelado, mensajeEnRuta, mensajeEntregado, type PedidoDelivery,
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

/**
 * Junta la lista de activos (`listPedidosDelivery(false)`) con la de cerrados
 * (`listPedidosDelivery(true)`). En la de activos una fila «cancelado» solo
 * puede estar porque la OC quedó libre otra vez: esa se puede tomar.
 * Orden: lo mío en curso, lo que está por tomar (urgente primero, como lo
 * manda la base), lo de otros en curso y los entregados más nuevos.
 */
export function armarFeed(activos: PedidoDelivery[], conCerrados: PedidoDelivery[]): PedidoFeed[] {
  const vistos = new Set<string>();
  const mios: PedidoFeed[] = [];
  const libres: PedidoFeed[] = [];
  const ajenos: PedidoFeed[] = [];
  for (const p of activos) {
    vistos.add(p.orden_id);
    if (p.estado === 'por_tomar' || p.estado === 'cancelado') libres.push({ p, disponible: true });
    else if (p.es_mio) mios.push({ p, disponible: false });
    else ajenos.push({ p, disponible: false });
  }
  mios.sort((a, b) => (a.p.estado === 'en_ruta' ? 0 : 1) - (b.p.estado === 'en_ruta' ? 0 : 1));
  const entregados = conCerrados
    .filter((p) => !vistos.has(p.orden_id) && p.estado === 'entregado')
    .sort((a, b) => t(b.entregado_en) - t(a.entregado_en))
    .slice(0, MAX_ENTREGADOS_TELEFONO)
    .map((p) => ({ p, disponible: false }));
  return [...mios, ...libres, ...ajenos, ...entregados];
}

export function enChip(f: PedidoFeed, chip: ChipDelivery): boolean {
  if (chip === 'todos') return true;
  if (chip === 'por_tomar') return f.disponible;
  if (chip === 'en_ruta') return !f.disponible && (f.p.estado === 'aceptado' || f.p.estado === 'en_ruta');
  return f.p.estado === 'entregado';
}

/** El pedido que este motorizado tiene en curso (en ruta primero). */
export function trabajoEnCurso(feed: PedidoFeed[]): PedidoDelivery | null {
  const mios = feed.filter((f) => !f.disponible && f.p.es_mio && (f.p.estado === 'aceptado' || f.p.estado === 'en_ruta'));
  return (mios.find((f) => f.p.estado === 'en_ruta') ?? mios[0])?.p ?? null;
}

/* ── Mensajes ── */

/** El mensaje del paso en que está el pedido, con las horas guardadas (para volver a verlo). */
export function mensajeDeEstado(
  p: PedidoDelivery, nombre: string, verAlmacen: (a: string) => string = (a) => a,
): { titulo: string; texto: string } | null {
  const quien = p.repartidor_nombre?.trim() || nombre;
  switch (p.estado) {
    case 'aceptado': return { titulo: 'Pedido aceptado', texto: mensajeAceptado(p, quien, p.aceptado_en) };
    case 'en_ruta': return { titulo: 'En ruta', texto: mensajeEnRuta(p, quien, p.en_ruta_en) };
    case 'entregado': return {
      titulo: 'Entregado en almacén',
      texto: mensajeEntregado(p, quien, verAlmacen(p.almacen_entrega ?? p.almacen_destino ?? '—'), p.nota_entrega, p.entregado_en),
    };
    case 'cancelado': return {
      titulo: 'Pedido cancelado',
      texto: mensajeCancelado(p, quien, p.motivo_cancel ?? '—', p.detalle_cancel, p.cancelado_en),
    };
    default: return null;
  }
}
