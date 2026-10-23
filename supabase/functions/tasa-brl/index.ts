// MGG · Edge Function: tasa-brl
// Real brasileño: cuántos R$ vale 1 USD (ej.: 20 $ = 100,86 R$ con 5,0428).
// Fuente primaria: open.er-api.com (gratis, sin key); respaldo: api.frankfurter.dev
// (tipos de cambio del Banco Central Europeo, también gratis y sin key).
// Guarda en `tasa_cambio` (moneda BRL, fuente er_api|frankfurter) y en
// `tasa_snapshot` (par BRL_USD). Se usa en RRHH: empresas con recibos en Real
// brasileño y el conversor $ ↔ R$ al cargar la nómina.
//
// AUTENTICACIÓN: la anon key viaja en el bundle, así que verify_jwt NO basta
// (ver _shared/auth.ts): aquí se exige un usuario con sesión y cuenta activa.
// Esta función es AUTÓNOMA (no importa ../_shared) para poder desplegarse sola.
//
// Throttle: si ya hay un BRL_USD de hace menos de 10 min se devuelve ese.
// Cada consulta externa tiene su timeout de 8 s: si una se cuelga, queda tiempo
// para el respaldo.
//
// Body: {} · Respuesta: { ok: true, brl_usd, fuente, fecha, at, cached }
// Env: SUPABASE_URL · SUPABASE_ANON_KEY · SUPABASE_SERVICE_ROLE_KEY
//      BRL_URL (opcional), BRL_FALLBACK_URL (opcional)

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const THROTTLE_MIN = 10;
const FETCH_TIMEOUT_MS = 8000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

const fetchT = (url: string) =>
  fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });

/** Número finito y > 0, o null. */
function positivo(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 4 decimales: el real vale ~5 por dólar y con 2 decimales se perdería más del 1 %. */
const round4 = (n: number) => Math.round(n * 10000) / 10000;

const fechaHoyVE = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas' }).format(new Date());

/** open.er-api.com → rates.BRL (R$ por 1 USD). */
async function erApi(url: string): Promise<number | null> {
  const resp = await fetchT(url);
  if (!resp.ok) return null;
  const data = await resp.json() as { result?: string; rates?: Record<string, number> };
  if (data?.result && data.result !== 'success') return null;
  return positivo(data?.rates?.BRL);
}

/** api.frankfurter.dev → rates.BRL (BCE). */
async function frankfurter(url: string): Promise<number | null> {
  const resp = await fetchT(url);
  if (!resp.ok) return null;
  const data = await resp.json() as { rates?: Record<string, number> };
  return positivo(data?.rates?.BRL);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !serviceKey || !anonKey) return json({ error: 'Supabase env vars faltantes' }, 500);

  // ── Quién llama: un usuario con sesión válida y cuenta activa ──
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return json({ error: 'No autenticado' }, 401);
  const comoLlamante = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: caller } = await comoLlamante.auth.getUser();
  if (!caller?.user) return json({ error: 'No autenticado' }, 401);
  const db = createClient(url, serviceKey);
  const { data: fila } = await db.from('usuarios').select('estado').eq('id', caller.user.id).maybeSingle();
  if (!fila) return json({ error: 'Usuario no registrado en el sistema' }, 403);
  if (fila.estado && fila.estado !== 'activo') return json({ error: 'Cuenta inhabilitada' }, 403);

  // ── Throttle ──
  const { data: ultimo, error: lecErr } = await db
    .from('tasa_snapshot').select('tasa, at, fuente').eq('par', 'BRL_USD')
    .order('at', { ascending: false }).limit(1).maybeSingle();
  if (lecErr) {
    console.error('tasa-brl: leer snapshot', lecErr);
    return json({ error: 'No se pudo leer la última tasa guardada' }, 500);
  }
  if (ultimo && Date.now() - new Date(String(ultimo.at)).getTime() < THROTTLE_MIN * 60_000) {
    return json({ ok: true, brl_usd: Number(ultimo.tasa), fuente: String(ultimo.fuente), fecha: fechaHoyVE(), at: String(ultimo.at), cached: true });
  }

  // ── Consulta externa: primaria y respaldo ──
  const urlPrimaria = Deno.env.get('BRL_URL') ?? 'https://open.er-api.com/v6/latest/USD';
  const urlRespaldo = Deno.env.get('BRL_FALLBACK_URL') ?? 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=BRL';
  let brlUsd: number | null = null;
  let fuente = 'er_api';
  try { brlUsd = await erApi(urlPrimaria); } catch (e) { console.warn('tasa-brl: er-api', e); brlUsd = null; }
  if (brlUsd == null) {
    fuente = 'frankfurter';
    try { brlUsd = await frankfurter(urlRespaldo); } catch (e) { console.warn('tasa-brl: frankfurter', e); brlUsd = null; }
  }
  if (brlUsd == null) return json({ error: 'No se pudo obtener la tasa del Real brasileño' }, 502);
  brlUsd = round4(brlUsd);

  const fecha = fechaHoyVE();
  const nowIso = new Date().toISOString();
  const { error: upErr } = await db.from('tasa_cambio').upsert(
    { fecha, moneda: 'BRL', tasa: brlUsd, fuente },
    { onConflict: 'fecha,moneda,fuente' },
  );
  if (upErr) {
    console.error('tasa-brl: guardar histórico', upErr);
    return json({ error: 'No se pudo guardar el histórico' }, 500);
  }
  const { error: snapErr } = await db.from('tasa_snapshot').insert({ par: 'BRL_USD', tasa: brlUsd, fuente, at: nowIso });
  if (snapErr) {
    console.error('tasa-brl: guardar snapshot', snapErr);
    return json({ error: 'No se pudo guardar la tasa en el historial' }, 500);
  }

  return json({ ok: true, brl_usd: brlUsd, fuente, fecha, at: nowIso, cached: false });
});
