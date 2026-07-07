/* ============================================================
   MGG · Caché de consultas (stale-while-revalidate)
   Objetivo: que al cambiar de pestaña las páginas NO tengan que
   re-consultar desde cero los datos compartidos (productos, almacenes,
   existencias, cajas, proveedores…). Se devuelve al instante lo último
   conocido y se revalida en segundo plano.

   Consistencia multiusuario: la caché se INVALIDA por realtime. Cada vez
   que llega un cambio de una tabla (useRealtime), se borran las entradas
   asociadas a esa tabla, de modo que la próxima lectura trae lo fresco.
   El TTL es solo un respaldo por si no hubiera evento realtime.
   ============================================================ */

interface Entry {
  at: number;                       // marca de tiempo del último dato bueno
  data: unknown;                    // último dato conocido (para SWR)
  inflight: Promise<unknown> | null; // petición en curso (dedupe)
  tables: string[];                 // tablas que invalidan esta entrada
}

const store = new Map<string, Entry>();

/**
 * Invalida las entradas de caché asociadas a alguna de `tables`. Sin argumento
 * (o lista vacía) limpia TODO. Lo llama useRealtime al recibir cambios.
 */
export function bustCache(tables?: string[]): void {
  if (!tables || !tables.length) { store.clear(); return; }
  const set = new Set(tables);
  for (const [key, e] of store) {
    if (e.tables.some((t) => set.has(t))) store.delete(key);
  }
}

function revalidate<T>(key: string, fetcher: () => Promise<T>, tables: string[]): Promise<T> {
  const p = fetcher()
    .then((data) => { store.set(key, { at: Date.now(), data, inflight: null, tables }); return data; })
    .catch((err) => { const cur = store.get(key); if (cur) cur.inflight = null; throw err; });
  const prev = store.get(key);
  store.set(key, { at: prev?.at ?? 0, data: prev?.data, inflight: p, tables });
  return p;
}

/**
 * Devuelve el resultado de `fetcher`, cacheado por `key`:
 *  - Si hay dato fresco (< ttl) → lo devuelve al instante (y revalida en 2.º
 *    plano si pasó de la mitad del TTL, para mantenerlo caliente).
 *  - Si hay una petición en curso → reusa esa promesa (dedupe).
 *  - Si no hay nada o está vencido → consulta y cachea.
 * `tables` marca qué cambios (realtime) deben invalidar esta entrada.
 */
export async function cachedQuery<T>(
  key: string,
  fetcher: () => Promise<T>,
  opts?: { ttl?: number; tables?: string[] },
): Promise<T> {
  const ttl = opts?.ttl ?? 30_000;
  const tables = opts?.tables ?? [];
  const now = Date.now();
  const e = store.get(key);

  if (e && e.data !== undefined && now - e.at < ttl) {
    if (!e.inflight && now - e.at > ttl / 2) void revalidate(key, fetcher, tables).catch(() => {});
    return e.data as T;
  }
  if (e?.inflight) return e.inflight as Promise<T>;
  return revalidate(key, fetcher, tables);
}
