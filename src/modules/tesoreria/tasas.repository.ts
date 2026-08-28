/* ============================================================
   MGG · Tesorería · Tasas de cambio (BCV)
   Tasa oficial del BCV para USD y EUR. La trae una Edge Function
   (`tasa-bcv`) desde una API pública y la cachea por día en `config`
   + historial en `tasa_cambio`. El euro es solo referencial (no hay
   caja en euros). Conversión con la fórmula del BCV, 2 decimales.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import type { MonedaTasa, TasaCambio, TasaHoy, TasaSnapshot } from '@/shared/lib/types';

const CONFIG_KEY = 'tesoreria.tasa_hoy';

/** Redondeo a 2 decimales (se aplica en cada cálculo). */
export function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Bs = monto extranjero × tasa BCV. */
export function aBs(montoExtranjero: number, tasa: number): number {
  return round2((Number(montoExtranjero) || 0) * (Number(tasa) || 0));
}

/** Monto extranjero = Bs ÷ tasa BCV. */
export function aExtranjero(montoBs: number, tasa: number): number {
  const t = Number(tasa) || 0;
  if (t <= 0) return 0;
  return round2((Number(montoBs) || 0) / t);
}

/** Fecha de hoy (YYYY-MM-DD) en horario de Venezuela. */
export function hoyVE(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas' }).format(new Date());
}

/** Lee el snapshot guardado en config (puede ser de un día anterior). */
async function leerSnapshot(): Promise<TasaHoy | null> {
  const { data } = await supabase.from('config').select('value').eq('key', CONFIG_KEY).maybeSingle();
  const v = data?.value as { usd?: number; eur?: number; fecha?: string } | undefined;
  if (!v || typeof v.usd !== 'number') return null;
  return { usd: v.usd, eur: typeof v.eur === 'number' ? v.eur : null, fecha: v.fecha ?? null };
}

/**
 * Tasa del día. Si el snapshot no es de hoy, invoca la Edge Function para
 * traerla (cache on-demand: el primer acceso del día la actualiza). Si la
 * API falla, cae a la última tasa conocida para no romper el navbar.
 */
/* ── Cache TTL en memoria para lecturas repetidas (tasa del día / mercado) ──
   Estas dos se piden en casi todos los modales de Tesorería/Compras (conversor,
   pagar, traslado, detalle de caja, compra directa…). Como las tasas cambian
   ~2×/día, un cache corto evita decenas de lecturas/Edge calls al abrir cada
   modal. Los botones "↻ Actualizar" lo invalidan con bustTasasCache(). */
const TASAS_TTL_MS = 60_000;
let _tasaHoyCache: { at: number; val: TasaHoy } | null = null;
let _mercadoCache: { at: number; val: TasasMercado } | null = null;

/** Invalida el cache en memoria de tasas (lo llaman las funciones de refresco).
 *  Emite un evento global para que el chip del navbar (y quien escuche) re-sincronice. */
export function bustTasasCache(): void {
  _tasaHoyCache = null; _mercadoCache = null;
  if (typeof window !== 'undefined') { try { window.dispatchEvent(new Event('mgg:tasas')); } catch { /* SSR/no-DOM */ } }
}

export async function getTasaHoy(): Promise<TasaHoy> {
  if (_tasaHoyCache && Date.now() - _tasaHoyCache.at < TASAS_TTL_MS) return _tasaHoyCache.val;
  const val = await _resolverTasaHoy();
  _tasaHoyCache = { at: Date.now(), val };
  return val;
}

async function _resolverTasaHoy(): Promise<TasaHoy> {
  const hoy = hoyVE();
  const snap = await leerSnapshot();
  if (snap && snap.fecha === hoy && snap.usd != null) return snap;

  try {
    const { data, error } = await supabase.functions.invoke<
      { ok: true; usd: number; eur: number | null; fecha: string } | { error: string }
    >('tasa-bcv', { body: {} });
    if (!error && data && 'ok' in data) return { usd: data.usd, eur: data.eur ?? null, fecha: data.fecha };
  } catch { /* sin conexión / función no desplegada: usamos lo último conocido */ }

  if (snap) return snap;
  // Último recurso: última fila por moneda del historial.
  return ultimaConocida();
}

/** Fuerza la actualización vía Edge Function (botón "Actualizar"). */
export async function refrescarTasa(): Promise<TasaHoy> {
  const { data, error } = await supabase.functions.invoke<
    { ok: true; usd: number; eur: number | null; fecha: string } | { error: string }
  >('tasa-bcv', { body: { force: true } });
  if (error) throw new Error(error.message ?? 'No se pudo actualizar la tasa');
  if (!data || 'error' in data) throw new Error((data as { error?: string })?.error || 'Respuesta inválida');
  bustTasasCache();
  return { usd: data.usd, eur: data.eur ?? null, fecha: data.fecha };
}

/** Última tasa conocida (por si no hay snapshot ni conexión). */
async function ultimaConocida(): Promise<TasaHoy> {
  const { data } = await supabase
    .from('tasa_cambio')
    .select('fecha, moneda, tasa')
    .order('fecha', { ascending: false })
    .limit(8);
  const rows = (data ?? []) as Array<{ fecha: string; moneda: MonedaTasa; tasa: number }>;
  const usdRow = rows.find((r) => r.moneda === 'USD');
  const eurRow = rows.find((r) => r.moneda === 'EUR');
  return {
    usd: usdRow ? Number(usdRow.tasa) : null,
    eur: eurRow ? Number(eurRow.tasa) : null,
    fecha: usdRow?.fecha ?? eurRow?.fecha ?? null,
  };
}

/** Corrección / carga manual de la tasa de una moneda (admin). Acepta cualquier
 *  moneda registrada (USD/EUR/USDT/COP o personalizada). */
export async function setTasaManual(input: { moneda: string; tasa: number; fecha?: string }): Promise<void> {
  const tasa = round2(Number(input.tasa) || 0);
  if (tasa <= 0) throw new Error('La tasa debe ser mayor que 0.');
  const fecha = input.fecha || hoyVE();

  const { error } = await supabase
    .from('tasa_cambio')
    .upsert({ fecha, moneda: input.moneda, tasa, fuente: 'manual' }, { onConflict: 'fecha,moneda,fuente' });
  if (error) throw error;

  // Si es la tasa de hoy, actualizamos el snapshot (conservando la otra moneda).
  if (fecha === hoyVE()) {
    const snap = (await leerSnapshot()) ?? { usd: null, eur: null, fecha };
    const nuevo = {
      usd: input.moneda === 'USD' ? tasa : snap.usd,
      eur: input.moneda === 'EUR' ? tasa : snap.eur,
      fecha,
    };
    await supabase.from('config').upsert(
      { key: CONFIG_KEY, value: nuevo, updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    );
  }

  // USDT/COP cargadas a mano también alimentan el gráfico (serie histórica).
  const par = input.moneda === 'USDT' ? 'USDT_VES' : input.moneda === 'COP' ? 'COP_USD' : null;
  if (par) await supabase.from('tasa_snapshot').insert({ par, tasa, fuente: 'manual' });
}

/** Historial de tasas filtrable por rango de fecha y moneda. */
export async function listHistorialTasas(filtros: { desde?: string; hasta?: string; moneda?: string } = {}): Promise<TasaCambio[]> {
  let q = supabase.from('tasa_cambio').select('*').order('fecha', { ascending: false }).order('moneda', { ascending: true });
  if (filtros.desde) q = q.gte('fecha', filtros.desde);
  if (filtros.hasta) q = q.lte('fecha', filtros.hasta);
  if (filtros.moneda) q = q.eq('moneda', filtros.moneda);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as TasaCambio[];
}

/** Tasa BCV del USD vigente en una fecha: la última registrada en `tasa_cambio` con
 *  fecha <= la pedida (si hay bcv y manual el mismo día, gana la MANUAL: es la corrección
 *  que cargó Tesorería, igual que en el snapshot de hoy). Sirve para valorar
 *  compras directas en Bs que no guardaron su tasa al montar. */
export async function tasaBcvEnFecha(fecha: string): Promise<{ tasa: number; fecha: string } | null> {
  const { data, error } = await supabase
    .from('tasa_cambio')
    .select('tasa, fecha')
    .eq('moneda', 'USD')
    .lte('fecha', fecha)
    .order('fecha', { ascending: false })
    .order('fuente', { ascending: false })   // 'manual' > 'bcv'
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { tasa: Number(data.tasa), fecha: String(data.fecha) };
}

/* ───────────── Tasas de mercado (USDT/VES Binance, COP/USD) ───────────── */

/** Tasas vigentes para el módulo multimoneda. */
export interface TasasMercado {
  bcvUsd: number | null;    // Bs por 1 USD (BCV)
  usdtVes: number | null;   // Bs por 1 USDT (Binance P2P)
  copUsd: number | null;    // COP por 1 USD
  fecha: string | null;
}

/** Última tasa conocida de una moneda en `tasa_cambio` (cualquier fuente). */
async function ultimaTasaMoneda(moneda: MonedaTasa): Promise<{ tasa: number; fecha: string } | null> {
  const { data } = await supabase
    .from('tasa_cambio')
    .select('tasa, fecha')
    .eq('moneda', moneda)
    .order('fecha', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return { tasa: Number(data.tasa), fecha: data.fecha as string };
}

/** Las 3 tasas de referencia del P2P de Binance (Bs por 1 USDT). */
export interface Binance3 {
  buy: number | null;       // COMPRA (lo que cobran al vender USDT)
  sell: number | null;      // VENTA (lo que pagan por USDT)
  promedio: number | null;  // punto medio
  at: string | null;
}

/** Fuerza la actualización (Edge Function Binance P2P) y devuelve las 3 tasas. */
export async function refrescarBinanceP2P(): Promise<Binance3> {
  const { data, error } = await supabase.functions.invoke<
    { ok: true; promedio: number; buy: number | null; sell: number | null; at: string } | { error: string }
  >('tasa-binance-p2p', { body: {} });
  if (error) throw new Error(error.message ?? 'No se pudo actualizar la tasa Binance');
  if (!data || 'error' in data) throw new Error((data as { error?: string })?.error || 'Respuesta inválida');
  bustTasasCache();
  return { buy: data.buy ?? null, sell: data.sell ?? null, promedio: data.promedio ?? null, at: data.at };
}

/** Últimas 3 tasas Binance guardadas (compra/venta/promedio). */
export async function getBinance3(): Promise<Binance3> {
  const { data } = await supabase
    .from('tasa_snapshot')
    .select('par, tasa, at')
    .in('par', ['USDT_VES', 'USDT_VES_BUY', 'USDT_VES_SELL'])
    .order('at', { ascending: false })
    .limit(30);
  const rows = (data ?? []) as Array<{ par: string; tasa: number; at: string }>;
  const ultima = (par: string): number | null => {
    const r = rows.find((x) => x.par === par);
    return r ? Number(r.tasa) : null;
  };
  return { buy: ultima('USDT_VES_BUY'), sell: ultima('USDT_VES_SELL'), promedio: ultima('USDT_VES'), at: rows[0]?.at ?? null };
}

/** Fuerza la actualización de la tasa COP/USD (Edge Function). */
export async function refrescarCop(): Promise<number> {
  const { data, error } = await supabase.functions.invoke<
    { ok: true; cop_usd: number } | { error: string }
  >('tasa-cop', { body: {} });
  if (error) throw new Error(error.message ?? 'No se pudo actualizar la tasa COP');
  if (!data || 'error' in data) throw new Error((data as { error?: string })?.error || 'Respuesta inválida');
  bustTasasCache();
  return data.cop_usd;
}

/**
 * Tasas de mercado para conversor/caja: BCV (USD), USDT/VES y COP/USD.
 * Lee lo último de BD; si USDT no está cargado hoy, intenta el Edge Function.
 */
export async function getTasasMercado(): Promise<TasasMercado> {
  if (_mercadoCache && Date.now() - _mercadoCache.at < TASAS_TTL_MS) return _mercadoCache.val;
  const val = await _resolverTasasMercado();
  _mercadoCache = { at: Date.now(), val };
  return val;
}

async function _resolverTasasMercado(): Promise<TasasMercado> {
  // USDT/VES: el promedio Binance vive en `tasa_snapshot` (USDT_VES) y es la MISMA
  // fuente que muestra el modal "Tasas Binance"; se prefiere por encima de la fila
  // de `tasa_cambio` (que puede quedar vieja) para que el navbar y el modal coincidan.
  const [bcv, usdtSnap, usdtCambio, cop] = await Promise.all([
    getTasaHoy().catch(() => ({ usd: null, eur: null, fecha: null } as TasaHoy)),
    ultimoSnapshot('USDT_VES'),
    ultimaTasaMoneda('USDT'),
    ultimaTasaMoneda('COP'),
  ]);
  let usdtVes = usdtSnap?.tasa ?? usdtCambio?.tasa ?? null;
  if (usdtVes == null) {
    try { usdtVes = (await refrescarBinanceP2P()).promedio; } catch { /* sin función desplegada */ }
  }
  let copUsd = cop?.tasa ?? null;
  if (copUsd == null) {
    try { copUsd = await refrescarCop(); } catch { /* sin función desplegada */ }
  }
  return {
    bcvUsd: bcv.usd,
    usdtVes,
    copUsd,
    fecha: bcv.fecha ?? usdtCambio?.fecha ?? cop?.fecha ?? null,
  };
}

/* ───────────── Cripto (CoinGecko, CORS público — se trae en el cliente) ───────────── */

export interface CriptoTasa {
  key: string;      // par snapshot (BTC_USD…)
  label: string;    // "Bitcoin (BTC)"
  usd: number | null;
  at: string | null;
}

const CRIPTO_DEF: Array<{ id: string; key: string; label: string }> = [
  { id: 'bitcoin', key: 'BTC_USD', label: 'Bitcoin (BTC)' },
  { id: 'ethereum', key: 'ETH_USD', label: 'Ethereum (ETH)' },
  { id: 'solana', key: 'SOL_USD', label: 'Solana (SOL)' },
  { id: 'binancecoin', key: 'BNB_USD', label: 'BNB (BNB)' },
];

/** Lectura rápida de cripto desde los últimos snapshots (sin red), en paralelo.
 *  Para la carga inicial: el cron y CoinGecko mantienen la serie al día. */
export async function getCriptoCache(): Promise<CriptoTasa[]> {
  const lasts = await Promise.all(CRIPTO_DEF.map((c) => ultimoSnapshot(c.key)));
  return CRIPTO_DEF.map((c, i) => ({ key: c.key, label: c.label, usd: lasts[i]?.tasa ?? null, at: lasts[i]?.at ?? null }));
}

/** Precios cripto en USD desde CoinGecko (CORS habilitado). Guarda snapshot
 *  para el historial, como máximo una vez por hora para no saturar la serie. */
export async function getCripto(): Promise<CriptoTasa[]> {
  const ids = CRIPTO_DEF.map((c) => c.id).join(',');
  let precios: Record<string, { usd?: number }> = {};
  try {
    const resp = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`, {
      headers: { accept: 'application/json' },
    });
    if (resp.ok) precios = await resp.json();
  } catch { /* sin conexión: caemos a último snapshot */ }

  const out: CriptoTasa[] = [];
  const aGuardar: Array<{ par: string; tasa: number; fuente: string }> = [];
  for (const c of CRIPTO_DEF) {
    const usd = Number(precios?.[c.id]?.usd);
    if (Number.isFinite(usd) && usd > 0) {
      out.push({ key: c.key, label: c.label, usd: round2(usd), at: null });
      aGuardar.push({ par: c.key, tasa: round2(usd), fuente: 'coingecko' });
    } else {
      const last = await ultimoSnapshot(c.key);
      out.push({ key: c.key, label: c.label, usd: last?.tasa ?? null, at: last?.at ?? null });
    }
  }
  if (aGuardar.length) await guardarSnapshotsThrottled(aGuardar, 'BTC_USD', 60);
  return out;
}

/** Fuerza la actualización de metales (Edge Function tasa-metales). */
export async function refrescarMetales(): Promise<void> {
  const { error } = await supabase.functions.invoke('tasa-metales', { body: {} });
  if (error) throw new Error(error.message ?? 'No se pudo actualizar metales');
}

/* ───────────── Metales (requiere fuente con API key vía Edge Function tasa-metales) ───────────── */

export interface MetalTasa {
  key: string;      // par snapshot (METAL_ESTANO…)
  label: string;
  usd: number | null;
  unidad: string;
  at: string | null;
  manual?: boolean; // true = no lo trae la API (se carga a mano), p. ej. estaño
}

/** Guarda manualmente el precio (USD) de un metal (admin). Alimenta la tarjeta y el historial. */
export async function setMetalManual(key: string, usd: number): Promise<void> {
  const v = round2(Number(usd) || 0);
  if (v <= 0) throw new Error('El precio debe ser mayor que 0.');
  await supabase.from('tasa_snapshot').insert({ par: key, tasa: v, fuente: 'manual' });
}

// Fuente: commoditypriceapi.com (incluye estaño/TIN). Unidades según la API.
const METAL_DEF: Array<{ key: string; label: string; unidad: string; manual?: boolean }> = [
  { key: 'METAL_ESTANO', label: 'Estaño', unidad: 'Tonelada' },
  { key: 'METAL_COBRE', label: 'Cobre', unidad: 'Libra' },
  { key: 'METAL_ALUMINIO', label: 'Aluminio', unidad: 'Tonelada' },
  { key: 'METAL_NIQUEL', label: 'Níquel', unidad: 'Tonelada' },
  { key: 'METAL_ZINC', label: 'Zinc', unidad: 'Tonelada' },
  { key: 'METAL_PLOMO', label: 'Plomo', unidad: 'Tonelada' },
  { key: 'METAL_ORO', label: 'Oro', unidad: 'Onza' },
  { key: 'METAL_PLATA', label: 'Plata', unidad: 'Onza' },
];

/** Precios de metales (USD) desde el último snapshot guardado por la Edge
 *  Function `tasa-metales`. Si no hay key configurada, devuelven null. */
export async function getMetales(): Promise<MetalTasa[]> {
  // Lecturas en paralelo (antes eran 8 consultas en serie).
  const lasts = await Promise.all(METAL_DEF.map((m) => ultimoSnapshot(m.key)));
  return METAL_DEF.map((m, i) => ({
    key: m.key, label: m.label, unidad: m.unidad,
    usd: lasts[i]?.tasa ?? null, at: lasts[i]?.at ?? null, manual: m.manual,
  }));
}

/* ───────────── Auto-refresco "2× al día" del lado del cliente (respaldo del cron) ───────────── */

/** Último snapshot de un par. */
async function ultimoSnapshot(par: string): Promise<{ tasa: number; at: string } | null> {
  const { data } = await supabase
    .from('tasa_snapshot')
    .select('tasa, at')
    .eq('par', par)
    .order('at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return { tasa: Number(data.tasa), at: data.at as string };
}

/** Inserta snapshots solo si el par "ancla" no se guardó en los últimos `minutos`. */
async function guardarSnapshotsThrottled(
  snaps: Array<{ par: string; tasa: number; fuente: string }>,
  parAncla: string,
  minutos: number,
): Promise<void> {
  const last = await ultimoSnapshot(parAncla);
  if (last) {
    const edadMin = (Date.now() - new Date(last.at).getTime()) / 60000;
    if (edadMin < minutos) return;
  }
  await supabase.from('tasa_snapshot').insert(snaps).select('id').then(() => {}, () => {});
}

/**
 * Refresco "perezoso" de respaldo: si la última tasa de mercado tiene más de
 * `horas` (por defecto 11), dispara los Edge Functions de BCV/Binance/COP. El
 * cron del servidor (8:00 y 16:00) es la vía principal; esto cubre cuando el
 * cron no está activo y alguien abre Tesorería.
 */
export async function refrescarTasasSiVencido(horas = 11): Promise<void> {
  const anclas = ['USDT_VES', 'COP_USD'];
  let masReciente = 0;
  for (const par of anclas) {
    const s = await ultimoSnapshot(par);
    if (s) masReciente = Math.max(masReciente, new Date(s.at).getTime());
  }
  const venc = masReciente === 0 || (Date.now() - masReciente) / 3600000 >= horas;
  if (!venc) return;
  await Promise.allSettled([refrescarTasa(), refrescarBinanceP2P(), refrescarCop()]);
}

/** Serie histórica de un par para el gráfico (más reciente primero). */
export async function listSnapshots(
  filtros: { par: string; desde?: string; hasta?: string; limit?: number } ,
): Promise<TasaSnapshot[]> {
  let q = supabase.from('tasa_snapshot').select('*').eq('par', filtros.par).order('at', { ascending: false });
  if (filtros.desde) q = q.gte('at', filtros.desde);
  if (filtros.hasta) q = q.lte('at', filtros.hasta);
  q = q.limit(filtros.limit ?? 200);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as TasaSnapshot[];
}
