/* ============================================================
   Golden Touch · Proveedores · ubicación en el mapa (03/11/2026)

   El punto del local del proveedor (proveedores.lat / lng) para Delivery:
   ruta del motorizado y «proveedor más cercano». Acá vive lo que no toca
   pantalla ni base: validar un punto, leer coordenadas pegadas (o un enlace
   de Google Maps) y armar / leer la búsqueda de direcciones en Nominatim
   (OpenStreetMap, gratis y sin clave: máximo 1 consulta por segundo, sin
   buscar mientras se teclea). Se prueba en ubicacionProveedor.test.ts.
   ============================================================ */

export interface PuntoMapa { lat: number; lng: number }

/** Un punto usable: números finitos, dentro del rango y que no sea el 0,0 (dato vacío disfrazado). */
export function puntoValido(lat: unknown, lng: unknown): PuntoMapa | null {
  if (lat == null || lng == null || lat === '' || lng === '') return null;
  const a = Number(lat);
  const b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  if (a === 0 && b === 0) return null;
  return { lat: a, lng: b };
}

/** «8.286900, -62.746700» (6 decimales ≈ 10 cm). */
export function coordsTxt(p: PuntoMapa): string {
  return `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`;
}

/**
 * Coordenadas escritas o pegadas:
 * Interpreta automáticamente un único campo que puede recibir:
 *   1. Dirección física textual («Puerto Ordaz, Frente Materiales Gran Sabana»)
 *   2. Coordenadas decimales («8.2869, -62.7467», «8.2869 -62.7467», «(8.2869, -62.7467)»)
 *   3. Coordenadas con cardinalidad («8.2869° N, 62.7467° W», «8.2869 N, 62.7467 O»)
 *   4. Grados, Minutos y Segundos DMS («8°17'12.8"N 62°44'48.1"W»)
 *   5. Grados y Minutos Decimales DDM («8° 17.213' N, 62° 44.802' W»)
 *   6. Enlaces web de Google Maps (@lat,lng / ?q=lat,lng / destination= / /search/ / !3d!4d)
 *   7. Enlaces web de OpenStreetMap, Apple Maps, Waze, Bing Maps, Geo URI
 *   8. Códigos Plus Code OLC («76MV+CR Ciudad Guayana» o «67WV76MV+CR»)
 *
 * Devuelve `PuntoMapa` con { lat, lng } si se detectan coordenadas o URL con posición,
 * o `null` si el texto es una dirección para consultar en Nominatim.
 */
export function parsearCoordenadas(texto: string | null | undefined): PuntoMapa | null {
  let t = String(texto ?? '').trim();
  if (!t) return null;

  try {
    if (t.includes('%')) t = decodeURIComponent(t);
  } catch {
    // Si no es un URI bien formado, usar el texto original
  }

  // 1. URLs de mapas: Google Maps, Apple Maps, Waze, OSM, Bing
  // 1a. @lat,lng
  const arroba = t.match(/@(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (arroba) {
    const p = puntoValido(arroba[1], arroba[2]);
    if (p) return p;
  }

  // 1b. Parámetros de consulta (?q=, query=, ll=, sll=, destination=, daddr=, saddr=, center=, point=)
  const qParam = t.match(/[?&](?:q|query|ll|sll|destination|daddr|saddr|center|point)=(-?\d{1,2}(?:\.\d+)?)(?:,|%2C|\s+)\s*(-?\d{1,3}(?:\.\d+)?)/i);
  if (qParam) {
    const p = puntoValido(qParam[1], qParam[2]);
    if (p) return p;
  }

  // 1c. Rutas con /search/lat,lng o /dir/lat,lng o /place/.../lat,lng
  const rutaUrl = t.match(/\/(?:search|dir|place)\/(?:[^\/]*\/)*(-?\d{1,2}(?:\.\d+)?)[,;](-?\d{1,3}(?:\.\d+)?)/i);
  if (rutaUrl) {
    const p = puntoValido(rutaUrl[1], rutaUrl[2]);
    if (p) return p;
  }

  // 1d. Protobuf de Google Maps (!3dlat!4dlng)
  const proto = t.match(/!3d(-?\d{1,2}(?:\.\d+)?).*?!4d(-?\d{1,3}(?:\.\d+)?)/);
  if (proto) {
    const p = puntoValido(proto[1], proto[2]);
    if (p) return p;
  }

  // 1e. OpenStreetMap (?mlat=...&mlon=... o #map=zoom/lat/lng)
  const osmParam = t.match(/[?&]mlat=(-?\d{1,2}(?:\.\d+)?).*?[?&]mlon=(-?\d{1,3}(?:\.\d+)?)/i);
  if (osmParam) {
    const p = puntoValido(osmParam[1], osmParam[2]);
    if (p) return p;
  }
  const osmHash = t.match(/#map=\d+\/(-?\d{1,2}(?:\.\d+)?)\/(-?\d{1,3}(?:\.\d+)?)/i);
  if (osmHash) {
    const p = puntoValido(osmHash[1], osmHash[2]);
    if (p) return p;
  }

  // 1f. Waze (to=ll.lat,lng)
  const waze = t.match(/to=ll\.(-?\d{1,2}(?:\.\d+)?)[,;](-?\d{1,3}(?:\.\d+)?)/i);
  if (waze) {
    const p = puntoValido(waze[1], waze[2]);
    if (p) return p;
  }

  // 1g. Bing Maps (?cp=lat~lng o where1=lat,lng)
  const bing = t.match(/[?&]cp=(-?\d{1,2}(?:\.\d+)?)~(-?\d{1,3}(?:\.\d+)?)/i);
  if (bing) {
    const p = puntoValido(bing[1], bing[2]);
    if (p) return p;
  }
  const bingWhere = t.match(/[?&]where1=(-?\d{1,2}(?:\.\d+)?)[,;](-?\d{1,3}(?:\.\d+)?)/i);
  if (bingWhere) {
    const p = puntoValido(bingWhere[1], bingWhere[2]);
    if (p) return p;
  }

  // 1h. Geo URI (geo:lat,lng)
  const geoUri = t.match(/geo:(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/i);
  if (geoUri) {
    const p = puntoValido(geoUri[1], geoUri[2]);
    if (p) return p;
  }

  // 2. Grados, Minutos y Segundos (DMS): «8°17'12.8"N 62°44'48.1"W» o con «O» (Oeste)
  const dms = t.match(/(\d{1,2})[°\s]+(\d{1,2})['\s]+(\d{1,2}(?:\.\d+)?)["]?\s*([NSns])[,;\s]+(\d{1,3})[°\s]+(\d{1,2})['\s]+(\d{1,2}(?:\.\d+)?)["]?\s*([EWEOewoe])/);
  if (dms) {
    const latDeg = Number(dms[1]) + Number(dms[2]) / 60 + Number(dms[3]) / 3600;
    const lat = dms[4].toUpperCase() === 'S' ? -latDeg : latDeg;
    const lngDeg = Number(dms[5]) + Number(dms[6]) / 60 + Number(dms[7]) / 3600;
    const lng = ['W', 'O'].includes(dms[8].toUpperCase()) ? -lngDeg : lngDeg;
    const p = puntoValido(lat, lng);
    if (p) return p;
  }

  // 3. Grados y Minutos Decimales (DDM): «8° 17.213' N, 62° 44.802' W»
  const ddm = t.match(/(\d{1,2})[°\s]+(\d{1,2}(?:\.\d+)?)\s*[']?\s*([NSns])[,;\s]+(\d{1,3})[°\s]+(\d{1,2}(?:\.\d+)?)\s*[']?\s*([EWEOewoe])/);
  if (ddm) {
    const latDeg = Number(ddm[1]) + Number(ddm[2]) / 60;
    const lat = ddm[3].toUpperCase() === 'S' ? -latDeg : latDeg;
    const lngDeg = Number(ddm[4]) + Number(ddm[5]) / 60;
    const lng = ['W', 'O'].includes(ddm[6].toUpperCase()) ? -lngDeg : lngDeg;
    const p = puntoValido(lat, lng);
    if (p) return p;
  }

  // 4. Decimales con Cardinalidad: «8.2869° N, 62.7467° W» o «8.2869 N, 62.7467 O»
  const decCard = t.match(/(-?\d{1,2}(?:\.\d+)?)\s*°?\s*([NSns])[,;\s]+(-?\d{1,3}(?:\.\d+)?)\s*°?\s*([EWEOewoe])/);
  if (decCard) {
    const lat = Math.abs(Number(decCard[1])) * (decCard[2].toUpperCase() === 'S' ? -1 : 1);
    const lng = Math.abs(Number(decCard[3])) * (['W', 'O'].includes(decCard[4].toUpperCase()) ? -1 : 1);
    const p = puntoValido(lat, lng);
    if (p) return p;
  }

  // 5. Formato etiquetado (lat: 8.2869, lon: -62.7467)
  const etiquetado = t.match(/(?:lat|latitud|latitude)[:\s=]+(-?\d{1,2}(?:\.\d+)?)[,\s]+(?:lon|lng|longitud|longitude)[:\s=]+(-?\d{1,3}(?:\.\d+)?)/i);
  if (etiquetado) {
    const p = puntoValido(etiquetado[1], etiquetado[2]);
    if (p) return p;
  }

  // 6. Par decimal directo (con o sin paréntesis/corchetes): «8.2869, -62.7467», «(8.2869, -62.7467)»
  const parLimpio = t.replace(/^[\[\(]/, '').replace(/[\]\)]$/, '').trim();
  const par = parLimpio.match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (par) {
    const p = puntoValido(par[1], par[2]);
    if (p) return p;
  }

  // 7. Plus Codes (Open Location Code, ej: 76MV+CR Ciudad Guayana)
  const plus = decodificarPlusCode(t);
  if (plus) return plus;

  // 8. Coordenadas decimales embebidas en cualquier texto si hay al menos 3 decimales
  const embebido = t.match(/(-?\d{1,2}\.\d{3,})\s*[,;\s]\s*(-?\d{1,3}\.\d{3,})/);
  if (embebido) {
    const p = puntoValido(embebido[1], embebido[2]);
    if (p) return p;
  }

  return null;
}

export type TipoInterpretacion = 'coordenadas' | 'url' | 'direccion' | 'vacio';

export interface InterpretacionUbicacion {
  tipo: TipoInterpretacion;
  punto: PuntoMapa | null;
  etiqueta: string;
  textoOriginal: string;
  esUrlCorta?: boolean;
}

/**
 * Interpreta inteligentemente el contenido de un único campo de entrada para determinar
 * si el usuario escribió una dirección, pegó coordenadas o pegó una URL de mapas.
 */
export function interpretarEntradaUbicacion(entrada: string | null | undefined): InterpretacionUbicacion {
  const texto = String(entrada ?? '').trim();
  if (!texto) {
    return { tipo: 'vacio', punto: null, etiqueta: '', textoOriginal: '' };
  }

  const esUrl = /^https?:\/\//i.test(texto) || /^www\./i.test(texto) || /^geo:/i.test(texto);
  const esUrlCorta = /(?:maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(texto);
  const coords = parsearCoordenadas(texto);

  if (esUrl) {
    if (coords) {
      return {
        tipo: 'url',
        punto: coords,
        etiqueta: `Enlace web · Coordenadas extraídas: ${coordsTxt(coords)}`,
        textoOriginal: texto,
        esUrlCorta: false,
      };
    }
    return {
      tipo: 'url',
      punto: null,
      etiqueta: esUrlCorta
        ? 'Enlace corto de Google Maps detectado: ábrelo en navegador y copia la URL completa con coordenadas o pega las coordenadas directas'
        : 'Enlace web sin coordenadas explícitas',
      textoOriginal: texto,
      esUrlCorta,
    };
  }

  if (coords) {
    return {
      tipo: 'coordenadas',
      punto: coords,
      etiqueta: `Coordenadas detectadas: ${coordsTxt(coords)}`,
      textoOriginal: texto,
    };
  }

  return {
    tipo: 'direccion',
    punto: null,
    etiqueta: 'Dirección física / punto de referencia para buscar en el mapa',
    textoOriginal: texto,
  };
}

/* ── Plus Codes (Open Location Code, el «76MV+CR» de Google Maps) ── */

const OLC = '23456789CFGHJMPQRVWX';
/** Referencia para los códigos cortos: Ciudad Guayana (Puerto Ordaz). Un código corto de
 *  4+2 se resuelve en ±0,5° alrededor, que cubre de sobra la zona donde opera GT. */
export const REFERENCIA_PLUS_CODE: PuntoMapa = { lat: 8.2869, lng: -62.7467 };

function olcCentro(codigo: string): PuntoMapa | null {
  const [antes, despues = ''] = codigo.toUpperCase().split('+');
  const digitos = (antes + despues).replace(/0/g, '');
  let lat = -90; let lng = -180; let res = 20;
  let latRes = 20; let lngRes = 20;
  for (let i = 0; i < Math.min(digitos.length, 10); i += 2) {
    const a = OLC.indexOf(digitos[i]); const b = OLC.indexOf(digitos[i + 1] ?? '');
    if (a < 0 || b < 0) return null;
    lat += a * res; lng += b * res; latRes = res; lngRes = res;
    res /= 20;
  }
  // Del 11.º en adelante: grilla de 5 filas × 4 columnas.
  for (let i = 10; i < digitos.length; i++) {
    const v = OLC.indexOf(digitos[i]);
    if (v < 0) return null;
    latRes /= 5; lngRes /= 4;
    lat += Math.floor(v / 4) * latRes; lng += (v % 4) * lngRes;
  }
  return { lat: lat + latRes / 2, lng: lng + lngRes / 2 };
}

function olcPrefijo(p: PuntoMapa, largo: number): string {
  let lat = Math.min(Math.max(p.lat, -90), 89.999999) + 90;
  let lng = ((((p.lng + 180) % 360) + 360) % 360);
  let res = 20; let out = '';
  while (out.length < largo) {
    const a = Math.floor(lat / res); const b = Math.floor(lng / res);
    out += OLC[a] + OLC[b];
    lat -= a * res; lng -= b * res; res /= 20;
  }
  return out.slice(0, largo);
}

/** Un Plus Code (completo o corto) dentro del texto → su punto; `null` si no hay. */
export function decodificarPlusCode(texto: string, ref: PuntoMapa = REFERENCIA_PLUS_CODE): PuntoMapa | null {
  const m = String(texto ?? '').toUpperCase().match(/(?:^|[\s,])([23456789CFGHJMPQRVWX]{2,8}\+[23456789CFGHJMPQRVWX]{0,4})(?=$|[\s,])/);
  if (!m) return null;
  const codigo = m[1];
  const sep = codigo.indexOf('+');
  if (sep % 2 !== 0 || codigo.length - sep - 1 === 1) return null;
  if (sep === 8) { const c = olcCentro(codigo); return c ? puntoValido(c.lat, c.lng) : null; }
  // Corto: se completa con el prefijo de la referencia y se toma el más cercano a ella.
  const relleno = 8 - sep;
  const c = olcCentro(olcPrefijo(ref, relleno) + codigo);
  if (!c) return null;
  const resolucion = 20 ** (2 - relleno / 2);
  const mitad = resolucion / 2;
  let { lat, lng } = c;
  if (ref.lat + mitad < lat && lat - resolucion >= -90) lat -= resolucion;
  else if (ref.lat - mitad > lat && lat + resolucion <= 90) lat += resolucion;
  if (ref.lng + mitad < lng) lng -= resolucion;
  else if (ref.lng - mitad > lng) lng += resolucion;
  return puntoValido(lat, lng);
}

/* ── Búsqueda de direcciones (Nominatim de OpenStreetMap) ── */

export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
/** Política de uso de Nominatim: como máximo una consulta por segundo. */
export const NOMINATIM_MIN_MS = 1_100;
/** Menos letras que esto no se busca. */
export const BUSQUEDA_MIN_LETRAS = 3;

/**
 * URL de la búsqueda: solo Venezuela, en español, 5 resultados y el correo de
 * contacto de la empresa (Nominatim lo pide para poder avisar si algo anda mal;
 * el navegador no deja cambiar el User-Agent).
 */
export function urlNominatim(q: string, email?: string | null): string | null {
  const t = q.trim();
  if (t.length < BUSQUEDA_MIN_LETRAS) return null;
  const params = new URLSearchParams({
    format: 'jsonv2', q: t, countrycodes: 've', limit: '5', 'accept-language': 'es', addressdetails: '0',
  });
  if (email?.trim()) params.set('email', email.trim());
  return `${NOMINATIM_URL}?${params.toString()}`;
}

export interface ResultadoGeo { nombre: string; lat: number; lng: number }

/** Lo que devuelve Nominatim (lat/lon vienen como texto); descarta lo que no sirve. */
export function parsearNominatim(json: unknown): ResultadoGeo[] {
  if (!Array.isArray(json)) return [];
  const out: ResultadoGeo[] = [];
  for (const r of json as Array<Record<string, unknown>>) {
    const p = puntoValido(r?.lat, r?.lon);
    if (!p) continue;
    const nombre = String(r?.display_name ?? r?.name ?? '').trim() || coordsTxt(p);
    out.push({ nombre, ...p });
  }
  return out;
}

/** ¿Se puede consultar ya? (pasó al menos NOMINATIM_MIN_MS desde la anterior) */
export function puedeConsultar(ultima: number | null, ahora: number): boolean {
  return ultima == null || ahora - ultima >= NOMINATIM_MIN_MS;
}

let ultimaConsulta: number | null = null;

/** Busca la dirección (o lee las coordenadas pegadas sin salir a internet). */
export async function buscarDireccion(q: string, email?: string | null, fetcher: typeof fetch = fetch): Promise<ResultadoGeo[]> {
  const coords = parsearCoordenadas(q);
  if (coords) return [{ nombre: `Coordenadas ${coordsTxt(coords)}`, ...coords }];
  const url = urlNominatim(q, email);
  if (!url) throw new Error(`Escribe al menos ${BUSQUEDA_MIN_LETRAS} letras para buscar.`);
  const ahora = Date.now();
  if (!puedeConsultar(ultimaConsulta, ahora)) {
    await new Promise((r) => setTimeout(r, NOMINATIM_MIN_MS - (ahora - (ultimaConsulta ?? 0))));
  }
  ultimaConsulta = Date.now();
  let res: Response;
  try {
    res = await fetcher(url, { headers: { Accept: 'application/json' } });
  } catch {
    throw new Error('No se pudo conectar con el buscador de direcciones (OpenStreetMap). Revisa la conexión o marca el punto en el mapa.');
  }
  if (!res.ok) throw new Error(`El buscador de direcciones respondió ${res.status}. Intenta en un momento o marca el punto en el mapa.`);
  return parsearNominatim(await res.json());
}
