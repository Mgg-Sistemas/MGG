/* ============================================================
   MGG · Coordenadas escritas o pegadas (03-11-2026)
   Pedido de la administradora: «que se pueda indicar la coordenada para el
   proveedor, y que esa dirección quede registrada para próximos usos».
   04-11-2026: también el CÓDIGO PLUS que da Google Maps al copiar una
   dirección («77V8+J6F, Carrera Nekuima…, Ciudad Guayana»). Se decodifica aquí
   mismo (Open Location Code), sin internet; el código corto se completa con
   Ciudad Guayana como referencia.
   Sin Leaflet, para poder probarlo solo.
   ============================================================ */

const NUM = String.raw`(-?\d{1,3}(?:\.\d+)?)`;
const RE_3D4D = new RegExp(String.raw`!3d${NUM}!4d${NUM}`);
const RE_ARROBA = new RegExp(String.raw`@${NUM},${NUM}`);
const RE_QUERY = new RegExp(String.raw`[?&](?:q|query|ll|destination)=${NUM}(?:,|%2C)\s*${NUM}`, 'i');
const RE_PAR = new RegExp(String.raw`^${NUM}\s*[,;\s]\s*${NUM}$`);

export interface Coordenada { lat: number; lng: number }

/** Ciudad Guayana (Puerto Ordaz): la referencia para completar un código Plus corto. */
export const REFERENCIA_CIUDAD_GUAYANA: Coordenada = { lat: 8.2869, lng: -62.7467 };

const valida = (lat: number, lng: number): Coordenada | null =>
  (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null);

/* ── Código Plus (Open Location Code) ── */

const ALFABETO = '23456789CFGHJMPQRVWX';
const RES_PARES = [20, 1, 0.05, 0.0025, 0.000125];
const RE_PLUS = /(?:^|[\s,;(])([23456789CFGHJMPQRVWX]{2,8}\+[23456789CFGHJMPQRVWX]{0,3})(?=$|[\s,;)])/i;

/** El centro de un código Plus COMPLETO (8 caracteres antes del «+»). */
function decodificarPlusCompleto(codigo: string): Coordenada | null {
  const c = codigo.toUpperCase().replace('+', '').replace(/0+$/, '');
  if (c.length < 2 || [...c].some((ch) => !ALFABETO.includes(ch))) return null;
  let lat = -90; let lng = -180; let resLat = 20; let resLng = 20;
  const pares = Math.min(c.length, 10);
  for (let i = 0; i < pares; i += 2) {
    const r = RES_PARES[i / 2];
    lat += ALFABETO.indexOf(c[i]) * r;
    if (i + 1 < pares) lng += ALFABETO.indexOf(c[i + 1]) * r;
    resLat = r; resLng = r;
  }
  // Más allá de 10 dígitos: cuadrícula de 5 filas × 4 columnas por carácter.
  for (let i = 10; i < c.length; i++) {
    resLat /= 5; resLng /= 4;
    const idx = ALFABETO.indexOf(c[i]);
    lat += Math.floor(idx / 4) * resLat;
    lng += (idx % 4) * resLng;
  }
  return valida(lat + resLat / 2, lng + resLng / 2);
}

/** Los primeros `n` caracteres del código Plus de un punto (para completar uno corto). */
function prefijoPlus(p: Coordenada, n: number): string {
  let lat = Math.min(Math.max(p.lat, -90), 89.999999) + 90;
  let lng = (((p.lng + 180) % 360) + 360) % 360;
  let out = '';
  for (let i = 0; out.length < n; i++) {
    const r = RES_PARES[i];
    const dLat = Math.floor(lat / r); lat -= dLat * r;
    const dLng = Math.floor(lng / r); lng -= dLng * r;
    out += ALFABETO[dLat] + ALFABETO[dLng];
  }
  return out.slice(0, n);
}

/**
 * El centro de un código Plus («77V8+J6F» o «67F477V8+J6F»). El corto se completa
 * con el punto de referencia más cercano (Ciudad Guayana por defecto), como hace Google.
 */
export function decodificarPlus(codigo: string, ref: Coordenada = REFERENCIA_CIUDAD_GUAYANA): Coordenada | null {
  const c = codigo.trim().toUpperCase();
  const mas = c.indexOf('+');
  if (mas < 0 || mas > 8 || mas % 2 !== 0) return null;
  if (mas === 8) return decodificarPlusCompleto(c);
  const faltan = 8 - mas;
  const completo = decodificarPlusCompleto(prefijoPlus(ref, faltan) + c);
  if (!completo) return null;
  // Si el centro quedó a más de media celda de la referencia, se corre una celda (recoverNearest).
  const res = Math.pow(20, 2 - faltan / 2);
  const medio = res / 2;
  let { lat, lng } = completo;
  if (ref.lat + medio < lat && lat - res >= -90) lat -= res;
  else if (ref.lat - medio > lat && lat + res <= 90) lat += res;
  if (ref.lng + medio < lng) lng -= res;
  else if (ref.lng - medio > lng) lng += res;
  return valida(lat, lng);
}

/**
 * Lee unas coordenadas: «8.2869, -62.7467», «8.2869;-62.7467», «8.2869 -62.7467», un
 * enlace de Google Maps («…/@8.2869,-62.7467,17z», «?q=8.2869,-62.7467»,
 * «!3d8.2869!4d-62.7467»; este último es el punto exacto del lugar y manda) o un
 * código Plus, solo o al inicio de la dirección que copia Google («77V8+J6F, …»).
 * Los decimales van con punto. Devuelve null si no hay nada que leer.
 */
export function leerCoordenadas(texto: string | null | undefined, ref: Coordenada = REFERENCIA_CIUDAD_GUAYANA): Coordenada | null {
  const t = (texto ?? '').trim();
  if (!t) return null;
  const m = RE_3D4D.exec(t) ?? RE_ARROBA.exec(t) ?? RE_QUERY.exec(t) ?? RE_PAR.exec(t);
  if (m) return valida(Number(m[1]), Number(m[2]));
  const plus = RE_PLUS.exec(t);
  if (plus) return decodificarPlus(plus[1], ref);
  return null;
}
