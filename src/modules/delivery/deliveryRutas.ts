/* ============================================================
   MGG · Delivery · mapa y rutas (03-11-2026)

   Pedido de la administradora (tipo Yummy / Ridery): el delivery ve en el
   teléfono dónde está, cuál es el proveedor más cercano entre las OC
   pagadas y la ruta al proveedor y de ahí al almacén; la PC ve a todos con
   su ruta. Acá vive lo que no toca pantalla ni base: distancias, el orden
   por cercanía, las paradas de cada pedido, los enlaces de Google Maps y
   Waze y la lectura de la ruta de OSRM (con línea recta si falla).
   ============================================================ */
import { esRetiro, type PedidoDelivery } from './delivery';
import { distanciaMetros, type PedidoFeed, type PuntoGps } from './deliveryMovil';

export type Punto = PuntoGps;

/* ── Almacenes de entrega ── */

export type ClaveDestino = 'LOS PINOS' | 'MATANZA';
export const CLAVES_DESTINO: ClaveDestino[] = ['LOS PINOS', 'MATANZA'];

export interface DestinoAlmacen {
  clave: ClaveDestino;
  lat: number | null;
  lng: number | null;
  /** Coordenada de partida, sin confirmar en el sitio: la PC avisa que conviene ubicarla bien. */
  aproximada: boolean;
}
export type DestinosDelivery = Record<ClaveDestino, DestinoAlmacen>;

/**
 * Lo mismo que siembra delivery-mapa-rutas-2026-11-03.sql: Matanza en la Zona
 * Industrial Matanzas (aproximada) y Los Pinos sin ubicar hasta que se marque.
 */
export const DESTINOS_POR_DEFECTO: DestinosDelivery = {
  'LOS PINOS': { clave: 'LOS PINOS', lat: null, lng: null, aproximada: true },
  MATANZA: { clave: 'MATANZA', lat: 8.2905, lng: -62.829, aproximada: true },
};

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Lee config `delivery.destinos` (lo que no venga o venga mal queda como por defecto). */
export function leerDestinos(raw: unknown): DestinosDelivery {
  const out: DestinosDelivery = {
    'LOS PINOS': { ...DESTINOS_POR_DEFECTO['LOS PINOS'] },
    MATANZA: { ...DESTINOS_POR_DEFECTO.MATANZA },
  };
  if (!raw || typeof raw !== 'object') return out;
  for (const clave of CLAVES_DESTINO) {
    const v = (raw as Record<string, unknown>)[clave];
    if (!v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    const p = { lat: num(o.lat), lng: num(o.lng) };
    const ok = p.lat !== null && p.lng !== null && puntoValido({ lat: p.lat, lng: p.lng });
    out[clave] = { clave, lat: ok ? p.lat : null, lng: ok ? p.lng : null, aproximada: o.aproximada !== false };
  }
  return out;
}

export function puntoDeDestino(d: DestinoAlmacen | null | undefined): Punto | null {
  return d && d.lat !== null && d.lng !== null ? { lat: d.lat, lng: d.lng } : null;
}

const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

/**
 * A cuál de los dos almacenes de entrega apunta lo que dice la orden: «Los Pinos» /
 * «LOS PINOS» → LOS PINOS; «General» (el principal de Matanza), «MATANZA» o la sede
 * «CENTRO DE FUNDICION - MATANZAS» → MATANZA. Otro lugar: null.
 */
export function claveDestino(almacen: string | null | undefined): ClaveDestino | null {
  const a = sinAcentos(String(almacen ?? ''));
  if (!a) return null;
  if (a.includes('PINOS')) return 'LOS PINOS';
  if (a === 'GENERAL' || a.includes('MATANZA')) return 'MATANZA';
  return null;
}

/* ── Puntos y distancias ── */

/** Coordenada usable (números finitos, dentro de rango y no el 0,0 de un GPS sin señal). */
export function puntoValido(p: Partial<Punto> | null | undefined): p is Punto {
  if (!p) return false;
  const { lat, lng } = p;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  return !(lat === 0 && lng === 0);
}

/** «850 m» o «2,3 km». */
export function distanciaTxt(metros: number | null | undefined): string {
  if (metros === null || metros === undefined || !Number.isFinite(metros)) return '—';
  if (metros < 1000) return `${Math.max(0, Math.round(metros / 10) * 10)} m`;
  return `${(metros / 1000).toLocaleString('es-VE', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} km`;
}

/** «8 min» o «1 h 05 min». */
export function tiempoRutaTxt(segundos: number | null | undefined): string {
  if (segundos === null || segundos === undefined || !Number.isFinite(segundos)) return '—';
  const min = Math.max(1, Math.round(segundos / 60));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

/* ── Proveedor más cercano ── */

/** El punto donde se busca el pedido: el proveedor de la OC o, en un retiro, Los Pinos. */
export function puntoOrigen(
  p: Pick<PedidoDelivery, 'proveedor_id' | 'tipo'>, proveedores: Map<string, Punto>, destinos: DestinosDelivery,
): Punto | null {
  if (esRetiro(p)) return puntoDeDestino(destinos['LOS PINOS']);
  const u = p.proveedor_id ? proveedores.get(p.proveedor_id) : undefined;
  return puntoValido(u) ? u : null;
}

export interface ProveedorCercano {
  proveedor_id: string;
  nombre: string;
  punto: Punto;
  metros: number;
  /** Cuántas OC por tomar tiene ese proveedor. */
  pedidos: number;
}

/**
 * Proveedores con OC por tomar ordenados del más cercano al más lejano (los que no
 * están ubicados no entran). Sin mi ubicación: lista vacía.
 */
export function proveedoresCercanos(
  yo: Punto | null, libres: Array<Pick<PedidoDelivery, 'proveedor_id' | 'proveedor_nombre' | 'tipo'>>, proveedores: Map<string, Punto>,
): ProveedorCercano[] {
  if (!puntoValido(yo)) return [];
  const acc = new Map<string, ProveedorCercano>();
  for (const p of libres) {
    if (esRetiro(p) || !p.proveedor_id) continue;
    const punto = proveedores.get(p.proveedor_id);
    if (!puntoValido(punto)) continue;
    const ya = acc.get(p.proveedor_id);
    if (ya) { ya.pedidos++; continue; }
    acc.set(p.proveedor_id, {
      proveedor_id: p.proveedor_id, nombre: p.proveedor_nombre ?? 'Proveedor', punto, metros: distanciaMetros(yo, punto), pedidos: 1,
    });
  }
  return [...acc.values()].sort((a, b) => a.metros - b.metros || a.nombre.localeCompare(b.nombre, 'es'));
}

/**
 * Ordena por cercanía solo el bloque de pedidos por tomar del listado (lo mío en curso
 * sigue arriba, lo ajeno y lo entregado abajo). Dentro del bloque, lo urgente primero
 * y después del más cercano al más lejano; sin distancia, al final y en su orden.
 */
export function ordenarLibresPorCercania(feed: PedidoFeed[], metrosDe: (p: PedidoDelivery) => number | null): PedidoFeed[] {
  const idx = feed.map((f, i) => (f.disponible ? i : -1)).filter((i) => i >= 0);
  if (idx.length < 2) return feed;
  const libres = idx.map((i, orden) => ({ f: feed[i], orden, m: metrosDe(feed[i].p) }));
  libres.sort((a, b) => (Number(b.f.p.urgente) - Number(a.f.p.urgente))
    || ((a.m === null ? 1 : 0) - (b.m === null ? 1 : 0))
    || ((a.m ?? 0) - (b.m ?? 0))
    || (a.orden - b.orden));
  const out = [...feed];
  idx.forEach((i, k) => { out[i] = libres[k].f; });
  return out;
}

/* ── Paradas y ruta del pedido ── */

export interface ParadasPedido {
  /** Donde se busca: proveedor (OC) o Los Pinos (retiro). */
  origen: Punto | null;
  /** Almacén de entrega (LOS PINOS / MATANZA) si se sabe. */
  destino: Punto | null;
  destinoClave: ClaveDestino | null;
  /** Ya lo recogió: subió fotos al recibir. La ruta va directo al almacén. */
  recogido: boolean;
}

export function paradasDelPedido(
  p: Pick<PedidoDelivery, 'proveedor_id' | 'tipo' | 'almacen_destino' | 'almacen_entrega' | 'fotos_recibo'>,
  proveedores: Map<string, Punto>, destinos: DestinosDelivery,
): ParadasPedido {
  const destinoClave = claveDestino(p.almacen_entrega ?? p.almacen_destino);
  return {
    origen: puntoOrigen(p, proveedores, destinos),
    destino: destinoClave ? puntoDeDestino(destinos[destinoClave]) : null,
    destinoClave,
    recogido: (p.fotos_recibo?.length ?? 0) > 0,
  };
}

const mismoPunto = (a: Punto, b: Punto) => distanciaMetros(a, b) < 15;

/** Puntos de la ruta: yo → proveedor (si falta recogerlo) → almacén. Sin repetidos ni inválidos. */
export function puntosRuta(yo: Punto | null, paradas: ParadasPedido): Punto[] {
  const crudo = [yo, paradas.recogido ? null : paradas.origen, paradas.destino];
  const out: Punto[] = [];
  for (const p of crudo) {
    if (!puntoValido(p)) continue;
    if (out.length && mismoPunto(out[out.length - 1], p)) continue;
    out.push(p);
  }
  return out;
}

/** A dónde va ahora: el proveedor si falta recogerlo; si no, el almacén. */
export function proximaParada(paradas: ParadasPedido): Punto | null {
  if (!paradas.recogido && paradas.origen) return paradas.origen;
  return paradas.destino ?? paradas.origen;
}

/* ── Enlaces de navegación (se abren solo al tocar el botón) ── */

const c6 = (p: Punto) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;

/**
 * Google Maps con la ruta en carro. Sin origen arranca donde está el teléfono.
 * `paradas` son puntos intermedios (p. ej. el proveedor antes del almacén).
 */
export function googleMapsHref(destino: Punto, paradas: Punto[] = [], origen?: Punto | null): string {
  const q = new URLSearchParams({ api: '1', destination: c6(destino), travelmode: 'driving' });
  if (puntoValido(origen)) q.set('origin', c6(origen));
  const intermedias = paradas.filter((p) => puntoValido(p));
  if (intermedias.length) q.set('waypoints', intermedias.map(c6).join('|'));
  return `https://www.google.com/maps/dir/?${q.toString()}`;
}

/** Waze navega a un solo punto (la próxima parada). */
export function wazeHref(destino: Punto): string {
  return `https://waze.com/ul?ll=${encodeURIComponent(c6(destino))}&navigate=yes`;
}

/* ── Ruta por calle (OSRM) con línea recta de respaldo ── */

export const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving';

export interface Ruta {
  linea: Punto[];
  metros: number;
  segundos: number | null;
  /** 'osrm' = por calle · 'recta' = no se pudo calcular: línea recta entre paradas. */
  fuente: 'osrm' | 'recta';
}

/** URL del servicio de rutas: OSRM pide «lng,lat» separados por «;». */
export function urlRutaOsrm(puntos: Punto[]): string {
  const coords = puntos.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  return `${OSRM_BASE}/${coords}?overview=full&geometries=geojson&alternatives=false&steps=false`;
}

/** Lee la respuesta de OSRM; null si no trae una ruta usable. */
export function leerRutaOsrm(json: unknown): Ruta | null {
  const j = json as { code?: string; routes?: Array<{ distance?: number; duration?: number; geometry?: { coordinates?: unknown } }> } | null;
  if (!j || j.code !== 'Ok' || !Array.isArray(j.routes) || !j.routes.length) return null;
  const r = j.routes[0];
  const coords = Array.isArray(r.geometry?.coordinates) ? (r.geometry!.coordinates as unknown[]) : [];
  const linea: Punto[] = [];
  for (const c of coords) {
    if (!Array.isArray(c) || c.length < 2) continue;
    const p = { lat: Number(c[1]), lng: Number(c[0]) };
    if (puntoValido(p)) linea.push(p);
  }
  if (linea.length < 2 || !Number.isFinite(r.distance)) return null;
  return { linea, metros: Number(r.distance), segundos: Number.isFinite(r.duration) ? Number(r.duration) : null, fuente: 'osrm' };
}

/** Respaldo: línea recta entre las paradas (distancia en línea recta, sin tiempo). */
export function lineaRecta(puntos: Punto[]): Ruta {
  let metros = 0;
  for (let i = 1; i < puntos.length; i++) metros += distanciaMetros(puntos[i - 1], puntos[i]);
  return { linea: [...puntos], metros, segundos: null, fuente: 'recta' };
}

/** Moverse más que esto vuelve a pedir la ruta. */
export const RUTA_METROS = 150;
/** Nunca se pide la ruta más seguido que esto (el servidor público de OSRM es compartido). */
export const RUTA_MIN_MS = 15_000;

/** Clave de una lista de puntos redondeados a ~11 m (para la memoria de rutas y para comparar paradas). */
export function claveParadas(puntos: Punto[]): string {
  return puntos.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join(';');
}

/** Con qué se pidió la última ruta: las paradas (sin mi posición), desde dónde y cuándo. */
export interface MarcaRuta { paradas: string; desde: Punto | null; t: number }

export function marcaRuta(desde: Punto | null, paradas: ParadasPedido, t: number): MarcaRuta {
  const ps = [paradas.recogido ? null : paradas.origen, paradas.destino].filter((p): p is Punto => puntoValido(p));
  return { paradas: claveParadas(ps), desde: puntoValido(desde) ? desde : null, t };
}

/**
 * ¿Hay que volver a pedir la ruta? La primera vez, si cambian las paradas (otro
 * proveedor, otro almacén, ya recogió) o si aparece / se pierde el GPS. Por moverse,
 * solo si se alejó más de RUTA_METROS y pasaron al menos RUTA_MIN_MS.
 */
export function debeRecalcularRuta(anterior: MarcaRuta | null, ahora: MarcaRuta): boolean {
  if (!anterior) return true;
  if (anterior.paradas !== ahora.paradas) return true;
  if (!anterior.desde !== !ahora.desde) return true;
  if (!anterior.desde || !ahora.desde) return false;
  if (ahora.t - anterior.t < RUTA_MIN_MS) return false;
  return distanciaMetros(anterior.desde, ahora.desde) > RUTA_METROS;
}

/* ── Detalle de un pedido ya tomado (PC · «Pedidos por delivery») ── */

export interface PasoTiempo { paso: string; minutos: number | null }

const minEntre = (a: string | null | undefined, b: string | null | undefined): number | null => {
  if (!a || !b) return null;
  const m = (new Date(b).getTime() - new Date(a).getTime()) / 60000;
  return Number.isFinite(m) && m >= 0 ? Math.round(m) : null;
};

/**
 * Tiempo de cada paso y total: tomado → en camino → entregado (o cancelado).
 * Desde el 02-11 aceptar ya lo deja en camino, así que el primer paso suele ser 0.
 */
export function tiemposPedido(p: {
  estado: string; aceptado_en: string | null; en_ruta_en: string | null; entregado_en: string | null; cancelado_en: string | null;
}): { pasos: PasoTiempo[]; total: number | null } {
  const fin = p.estado === 'cancelado' ? p.cancelado_en : p.entregado_en;
  const pasos: PasoTiempo[] = [{ paso: 'Tomado → en camino', minutos: minEntre(p.aceptado_en, p.en_ruta_en) }];
  if (p.estado === 'cancelado') pasos.push({ paso: 'En camino → cancelado', minutos: minEntre(p.en_ruta_en ?? p.aceptado_en, fin) });
  else pasos.push({ paso: 'En camino → entregado', minutos: minEntre(p.en_ruta_en ?? p.aceptado_en, fin) });
  return { pasos, total: minEntre(p.aceptado_en, fin) };
}

/**
 * Ruta planeada de un pedido ya hecho: desde donde lo tomó (primer punto del
 * recorrido guardado, si hay) → proveedor → almacén donde lo entregó.
 */
export function puntosRutaPlaneada(inicio: Punto | null, origen: Punto | null, destino: Punto | null): Punto[] {
  return puntosRuta(inicio, { origen, destino, destinoClave: null, recogido: false });
}

/** Distancia recorrida según el recorrido guardado (suma de tramos). */
export function metrosRecorrido(puntos: Punto[]): number {
  let m = 0;
  for (let i = 1; i < puntos.length; i++) m += distanciaMetros(puntos[i - 1], puntos[i]);
  return m;
}
