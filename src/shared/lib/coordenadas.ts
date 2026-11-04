/* ============================================================
   MGG · Coordenadas escritas o pegadas (03-11-2026)
   Pedido de la administradora: «que se pueda indicar la coordenada para el
   proveedor, y que esa dirección quede registrada para próximos usos».
   Sin Leaflet, para poder probarlo solo.
   ============================================================ */

const NUM = String.raw`(-?\d{1,3}(?:\.\d+)?)`;
const RE_3D4D = new RegExp(String.raw`!3d${NUM}!4d${NUM}`);
const RE_ARROBA = new RegExp(String.raw`@${NUM},${NUM}`);
const RE_QUERY = new RegExp(String.raw`[?&](?:q|query|ll|destination)=${NUM}(?:,|%2C)\s*${NUM}`, 'i');
const RE_PAR = new RegExp(String.raw`^${NUM}\s*[,;\s]\s*${NUM}$`);

/**
 * Lee unas coordenadas: «8.2869, -62.7467», «8.2869;-62.7467», «8.2869 -62.7467» o un
 * enlace de Google Maps («…/@8.2869,-62.7467,17z», «?q=8.2869,-62.7467»,
 * «!3d8.2869!4d-62.7467»; este último es el punto exacto del lugar y manda).
 * Los decimales van con punto. Devuelve null si no hay un par válido.
 */
export function leerCoordenadas(texto: string | null | undefined): { lat: number; lng: number } | null {
  const t = (texto ?? '').trim();
  if (!t) return null;
  const m = RE_3D4D.exec(t) ?? RE_ARROBA.exec(t) ?? RE_QUERY.exec(t) ?? RE_PAR.exec(t);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}
