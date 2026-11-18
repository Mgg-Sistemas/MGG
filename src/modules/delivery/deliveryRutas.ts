/* ============================================================
   MGG · Delivery · rutas y cercanía (03/11/2026)

   Pedido de la usuaria (estilo Yummy / Ridery): el motorizado ve en el
   teléfono su ubicación, el proveedor más cercano entre lo que está «Por
   tomar» y la ruta: de donde está → al proveedor (o al Almacén Los Pinos si
   es un retiro) → al Almacén Los Pinos. La PC ve la ruta prevista de cada
   motorizado. Acá vive lo que no toca pantalla ni base (se prueba en
   deliveryRutas.test.ts): distancias, orden por cercanía, las paradas de la
   ruta, el enlace de Google Maps y la lectura de la respuesta de OSRM
   (router.project-osrm.org, servicio público y gratis: se le pide poco, de a
   una consulta por segundo y con caché). Si OSRM falla, va la línea recta.
   ============================================================ */
import { puntoValido, type PuntoMapa } from '@/modules/proveedores/ubicacionProveedor';
import { ALMACEN_RETIRO, almacenRecepcion, esRetiroAlmacen, type PedidoDelivery } from './delivery';
import { distanciaMetros } from './deliveryMovil';

export { puntoValido };
export type { PuntoMapa };

/** Clave del Almacén Los Pinos en `delivery_lugares`. */
export const LUGAR_LOS_PINOS = 'los_pinos';

/** Un punto fijo de la ruta (`delivery_lugares`). */
export interface LugarDelivery {
  clave: string;
  nombre: string;
  lat: number | null;
  lng: number | null;
  actualizado_en: string | null;
  actualizado_por: string | null;
}

/** Ubicación de cada proveedor (id → punto); los que no tienen no están. */
export type UbicacionesProveedores = Map<string, PuntoMapa>;

/** El punto de un lugar fijo, o null si todavía no se marcó. */
export function puntoLugar(lugares: LugarDelivery[], clave: string): PuntoMapa | null {
  const l = lugares.find((x) => x.clave === clave);
  return l ? puntoValido(l.lat, l.lng) : null;
}

/* ── Textos ── */

/** «850 m», «2,4 km», «12 km». */
export function distanciaTxt(metros: number | null | undefined): string {
  if (metros == null || !Number.isFinite(metros) || metros < 0) return '—';
  if (metros < 1000) return `${Math.max(10, Math.round(metros / 10) * 10)} m`;
  const km = metros / 1000;
  return `${km.toLocaleString('es-VE', { minimumFractionDigits: km < 10 ? 1 : 0, maximumFractionDigits: km < 10 ? 1 : 0 })} km`;
}

/** «≈ 12 min», «≈ 1 h 05 min». */
export function duracionTxt(segundos: number | null | undefined): string {
  if (segundos == null || !Number.isFinite(segundos) || segundos < 0) return '';
  const min = Math.max(1, Math.round(segundos / 60));
  if (min < 60) return `≈ ${min} min`;
  return `≈ ${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

/* ── Paradas ── */

/** ¿Ya lo recogió? (subió fotos al recibir del proveedor / al retirar en Almacén) */
export function yaRecogido(p: Pick<PedidoDelivery, 'fotos_recibo'>): boolean {
  return (p.fotos_recibo?.length ?? 0) > 0;
}

/** ¿La OC se entrega en el Almacén Los Pinos? (el General es Los Pinos) */
export function entregaEnLosPinos(p: Pick<PedidoDelivery, 'almacen_destino'>): boolean {
  const a = almacenRecepcion(p);
  return a === 'General' || /pinos/i.test(a);
}

/** Dónde se busca: el local del proveedor (OC) o el Almacén Los Pinos (retiro). */
export function puntoRecogida(
  p: Pick<PedidoDelivery, 'origen' | 'proveedor_id'>, provs: UbicacionesProveedores, losPinos: PuntoMapa | null,
): PuntoMapa | null {
  if (esRetiroAlmacen(p)) return losPinos;
  return p.proveedor_id ? provs.get(p.proveedor_id) ?? null : null;
}

/** Dónde se entrega: la OC al Almacén Los Pinos; el retiro va a una unidad / persona sin punto en el mapa. */
export function puntoEntrega(p: Pick<PedidoDelivery, 'origen' | 'almacen_destino'>, losPinos: PuntoMapa | null): PuntoMapa | null {
  if (esRetiroAlmacen(p)) return null;
  return entregaEnLosPinos(p) ? losPinos : null;
}

export interface ParadaRuta {
  tipo: 'yo' | 'recogida' | 'entrega';
  nombre: string;
  punto: PuntoMapa;
}

/** Dos puntos a menos de 30 m son el mismo lugar (no se repite la parada). */
const MISMO_LUGAR_M = 30;

/**
 * Las paradas de la ruta: desde donde estoy → a buscarlo (si todavía no lo
 * recogí) → a entregarlo en Los Pinos. Lo que no tiene punto se salta.
 */
export function paradasRuta(
  p: Pick<PedidoDelivery, 'origen' | 'proveedor_id' | 'proveedor_nombre' | 'almacen_destino' | 'fotos_recibo'>,
  yo: PuntoMapa | null, provs: UbicacionesProveedores, losPinos: PuntoMapa | null,
): ParadaRuta[] {
  const out: ParadaRuta[] = [];
  if (yo) out.push({ tipo: 'yo', nombre: 'Tú', punto: yo });
  const recogida = yaRecogido(p) ? null : puntoRecogida(p, provs, losPinos);
  if (recogida) {
    out.push({ tipo: 'recogida', nombre: esRetiroAlmacen(p) ? ALMACEN_RETIRO : (p.proveedor_nombre?.trim() || 'Proveedor'), punto: recogida });
  }
  const entrega = puntoEntrega(p, losPinos);
  if (entrega && !(recogida && distanciaMetros(recogida, entrega) < MISMO_LUGAR_M)) {
    out.push({ tipo: 'entrega', nombre: ALMACEN_RETIRO, punto: entrega });
  }
  return out;
}

/* ── Cercanía ── */

export interface ConDistancia<T> { item: T; metros: number | null }

/** Ordena del más cercano al más lejano; los que no tienen punto van al final (en el orden en que venían). */
export function ordenarPorCercania<T>(items: T[], punto: (x: T) => PuntoMapa | null, desde: PuntoMapa | null): ConDistancia<T>[] {
  const con = items.map((item, i) => {
    const p = desde ? punto(item) : null;
    return { item, metros: desde && p ? distanciaMetros(desde, p) : null, i };
  });
  con.sort((a, b) => {
    if (a.metros == null && b.metros == null) return a.i - b.i;
    if (a.metros == null) return 1;
    if (b.metros == null) return -1;
    return a.metros - b.metros || a.i - b.i;
  });
  return con.map(({ item, metros }) => ({ item, metros }));
}

/** El más cercano que tenga distancia (o null). */
export function masCercano<T>(lista: ConDistancia<T>[]): ConDistancia<T> | null {
  let mejor: ConDistancia<T> | null = null;
  for (const x of lista) if (x.metros != null && (mejor == null || x.metros < (mejor.metros as number))) mejor = x;
  return mejor;
}

/**
 * Orden de «Por tomar» en el teléfono: urgentes primero (como manda la base) y,
 * dentro de cada grupo, del más cercano al más lejano. Sin GPS queda el orden de la base.
 */
export function ordenarDisponibles<T extends { p: Pick<PedidoDelivery, 'urgente'> }>(
  items: T[], distancia: (x: T) => number | null,
): T[] {
  return items.map((x, i) => ({ x, i, d: distancia(x) })).sort((a, b) => {
    const u = (b.x.p.urgente ? 1 : 0) - (a.x.p.urgente ? 1 : 0);
    if (u) return u;
    if (a.d == null && b.d == null) return a.i - b.i;
    if (a.d == null) return 1;
    if (b.d == null) return -1;
    return a.d - b.d || a.i - b.i;
  }).map((y) => y.x);
}

/* ── Enlaces ── */

const ll = (p: PuntoMapa) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;

/**
 * Navegación paso a paso en Google Maps: origen (si no va, Google usa la
 * ubicación del teléfono), destino y paradas intermedias.
 */
export function urlGoogleMapsRuta(paradas: PuntoMapa[], conOrigen = true): string | null {
  const ps = paradas.filter((p) => puntoValido(p?.lat, p?.lng));
  if (!ps.length || (conOrigen && ps.length < 2)) return null;
  const origen = conOrigen ? ps[0] : null;
  const resto = conOrigen ? ps.slice(1) : ps;
  const destino = resto[resto.length - 1];
  const intermedios = resto.slice(0, -1);
  const q = new URLSearchParams({ api: '1' });
  if (origen) q.set('origin', ll(origen));
  q.set('destination', ll(destino));
  if (intermedios.length) q.set('waypoints', intermedios.map(ll).join('|'));
  q.set('travelmode', 'driving');
  return `https://www.google.com/maps/dir/?${q.toString()}`;
}

/** 10/11/2026 (maqueta): navegar con Waze hasta un punto. */
export function urlWaze(p: PuntoMapa | null | undefined): string | null {
  if (!p || !puntoValido(p.lat, p.lng)) return null;
  return `https://waze.com/ul?ll=${ll(p)}&navigate=yes`;
}

/** Navegación directa paso a paso hacia un destino en Google Maps (aprovecha GPS actual como origen si existe). */
export function urlNavegacionDestino(destino: PuntoMapa | null | undefined, yo: PuntoMapa | null | undefined): string | null {
  if (!destino || !puntoValido(destino.lat, destino.lng)) return null;
  const q = new URLSearchParams({ api: '1', destination: ll(destino), travelmode: 'driving' });
  if (yo && puntoValido(yo.lat, yo.lng)) {
    q.set('origin', ll(yo));
  }
  return `https://www.google.com/maps/dir/?${q.toString()}`;
}

/** 10/11/2026: la próxima parada del pedido (buscar donde el proveedor / Los Pinos, o entregar). */
export function siguienteParada(
  p: Pick<PedidoDelivery, 'origen' | 'proveedor_id' | 'proveedor_nombre' | 'almacen_destino' | 'fotos_recibo'>,
  provs: UbicacionesProveedores, losPinos: PuntoMapa | null,
): ParadaRuta | null {
  return paradasRuta(p, null, provs, losPinos)[0] ?? null;
}

/* ── OSRM ── */

export const OSRM_BASE = 'https://router.project-osrm.org';

/** URL de la ruta en auto por esos puntos (OSRM pide lng,lat). */
export function urlOsrm(puntos: PuntoMapa[], base = OSRM_BASE): string | null {
  if (puntos.length < 2) return null;
  const coords = puntos.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  return `${base}/route/v1/driving/${coords}?overview=full&geometries=geojson&alternatives=false&steps=false`;
}

export interface RutaCalculada {
  metros: number;
  /** null en la línea recta (no se sabe cuánto tarda). */
  segundos: number | null;
  /** [lat, lng] para dibujar en Leaflet. */
  linea: Array<[number, number]>;
  fuente: 'osrm' | 'recta';
}

/** Lee la respuesta de OSRM. null si no trae una ruta usable. */
export function parsearOsrm(json: unknown): RutaCalculada | null {
  const j = json as { code?: string; routes?: Array<{ distance?: number; duration?: number; geometry?: { coordinates?: unknown } }> } | null;
  if (!j || j.code !== 'Ok' || !Array.isArray(j.routes) || !j.routes.length) return null;
  const r = j.routes[0];
  const coords = Array.isArray(r.geometry?.coordinates) ? (r.geometry?.coordinates as unknown[]) : [];
  const linea: Array<[number, number]> = [];
  for (const c of coords) {
    if (!Array.isArray(c) || c.length < 2) continue;
    const p = puntoValido(c[1], c[0]);
    if (p) linea.push([p.lat, p.lng]);
  }
  const metros = Number(r.distance);
  if (linea.length < 2 || !Number.isFinite(metros)) return null;
  const s = Number(r.duration);
  return { metros, segundos: Number.isFinite(s) ? s : null, linea, fuente: 'osrm' };
}

/** Plan B: línea recta entre las paradas (con su distancia). */
export function rutaRecta(puntos: PuntoMapa[]): RutaCalculada {
  let metros = 0;
  for (let i = 1; i < puntos.length; i++) metros += distanciaMetros(puntos[i - 1], puntos[i]);
  return { metros, segundos: null, linea: puntos.map((p) => [p.lat, p.lng]), fuente: 'recta' };
}

/** Clave de caché: puntos redondeados a 4 decimales (~11 m). */
export function claveRuta(puntos: PuntoMapa[]): string {
  return puntos.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join(';');
}

/** OSRM público: como máximo una consulta por segundo. */
const OSRM_MIN_MS = 1_100;
const OSRM_TIMEOUT_MS = 8_000;
const CACHE_MAX = 40;
const cache = new Map<string, RutaCalculada>();
let cola: Promise<unknown> = Promise.resolve();
let ultimaOsrm = 0;

/**
 * La ruta en auto por esas paradas (OSRM). Si el servicio no responde, no hay
 * internet o tarda más de 8 s, devuelve la línea recta (nunca falla).
 */
export function calcularRuta(puntos: PuntoMapa[], fetcher: typeof fetch = fetch): Promise<RutaCalculada> {
  if (puntos.length < 2) return Promise.resolve(rutaRecta(puntos));
  const k = claveRuta(puntos);
  const hit = cache.get(k);
  if (hit) return Promise.resolve(hit);
  const url = urlOsrm(puntos);
  const tarea = cola.then(async (): Promise<RutaCalculada> => {
    const otra = cache.get(k);
    if (otra) return otra;
    const espera = OSRM_MIN_MS - (Date.now() - ultimaOsrm);
    if (espera > 0) await new Promise((r) => setTimeout(r, espera));
    ultimaOsrm = Date.now();
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = setTimeout(() => ctrl?.abort(), OSRM_TIMEOUT_MS);
    try {
      const res = await fetcher(url as string, { signal: ctrl?.signal });
      const ruta = res.ok ? parsearOsrm(await res.json()) : null;
      if (!ruta) return rutaRecta(puntos);
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
      cache.set(k, ruta);
      return ruta;
    } catch {
      return rutaRecta(puntos);
    } finally {
      clearTimeout(t);
    }
  });
  cola = tarea.catch(() => undefined);
  return tarea;
}

/** Moverse más que esto vuelve a pedir la ruta (para no consultar OSRM a cada paso). */
export const RECALCULAR_RUTA_M = 400;
