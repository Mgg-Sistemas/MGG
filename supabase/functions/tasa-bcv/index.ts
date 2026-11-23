// MGG · Edge Function: tasa-bcv
// Trae la tasa oficial del BCV (USD y EUR) desde una API pública y la guarda
// en `tasa_cambio` (historial) + `config` (snapshot del día). Cache diario:
// si ya existe la del día y no se fuerza, la devuelve sin volver a consultar.
//
// Body opcional: { force?: boolean }
// Respuesta: { ok: true, usd: number, eur: number|null, fecha: 'YYYY-MM-DD', cached: boolean }
//
// Env:
//   SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY (estándar)
//   BCV_API_URL (opcional; default pydolarve BCV)

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { fechaEfectivaBcv } from '../_shared/calendarioBancario.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

/** Fecha de hoy (YYYY-MM-DD) en horario de Venezuela. */
function fechaHoyVE(): string {
  // en-CA da formato YYYY-MM-DD directamente.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas' }).format(new Date());
}

function round2(n: number): number { return Math.round(n * 100) / 100; }

/** Extrae un precio numérico de varias formas posibles del payload. */
function precio(monitor: unknown): number | null {
  if (monitor == null) return null;
  if (typeof monitor === 'number') return Number.isFinite(monitor) ? monitor : null;
  if (typeof monitor === 'object') {
    const m = monitor as Record<string, unknown>;
    const cand = m.price ?? m.promedio ?? m.value ?? m.tasa;
    const n = Number(cand);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const n = Number(monitor);
  return Number.isFinite(n) && n > 0 ? n : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let payload: { force?: boolean } = {};
  try { payload = req.body ? await req.json() : {}; } catch { payload = {}; }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return json({ error: 'Supabase env vars faltantes' }, 500);
  const supabase = createClient(supabaseUrl, serviceKey);

  const fechaHoy = fechaHoyVE();
  const infoBancario = fechaEfectivaBcv(fechaHoy);
  // Cuando sea feriado bancario o fin de semana, la tasa rige para el próximo día hábil (ej: martes)
  const fecha = infoBancario.fecha;

  // 1) Cache: si ya tenemos la del día y no se fuerza, devolvemos lo guardado.
  if (!payload.force) {
    const { data: cfg } = await supabase.from('config').select('value').eq('key', 'tesoreria.tasa_hoy').maybeSingle();
    const v = cfg?.value as { usd?: number; eur?: number; fecha?: string } | undefined;
    if (v && (v.fecha === fecha || v.fecha === fechaHoy) && typeof v.usd === 'number') {
      return json({
        ok: true,
        usd: v.usd,
        eur: v.eur ?? null,
        fecha: v.fecha ?? fecha,
        esBancario: infoBancario.esBancario,
        proximoDiaHabil: infoBancario.fecha,
        motivoBancario: infoBancario.motivo,
        cached: true,
      });
    }
  }

  // 2) Consultar la API pública del BCV (USD y EUR oficiales, endpoints separados).
  //    Por defecto ve.dolarapi.com; configurable por env. Acepta también un único
  //    endpoint estilo pydolarve (monitors.usd/eur) vía BCV_API_URL.
  const usdUrl = Deno.env.get('BCV_USD_URL') ?? 'https://ve.dolarapi.com/v1/dolares/oficial';
  const eurUrl = Deno.env.get('BCV_EUR_URL') ?? 'https://ve.dolarapi.com/v1/euros/oficial';
  const singleUrl = Deno.env.get('BCV_API_URL'); // opcional: un endpoint con ambas
  let usd: number | null = null;
  let eur: number | null = null;
  try {
    if (singleUrl) {
      const resp = await fetch(singleUrl, { headers: { accept: 'application/json' } });
      if (!resp.ok) return json({ error: `API BCV respondió HTTP ${resp.status}` }, 502);
      const data = await resp.json() as Record<string, unknown>;
      const monitors = (data.monitors ?? data) as Record<string, unknown>;
      usd = precio(monitors.usd) ?? precio(data.usd);
      eur = precio(monitors.eur) ?? precio(data.eur);
    } else {
      const [ru, re] = await Promise.all([
        fetch(usdUrl, { headers: { accept: 'application/json' } }),
        fetch(eurUrl, { headers: { accept: 'application/json' } }).catch(() => null),
      ]);
      if (!ru.ok) return json({ error: `API BCV (USD) respondió HTTP ${ru.status}` }, 502);
      usd = precio(await ru.json());
      if (re && re.ok) eur = precio(await re.json());
    }
  } catch (e) {
    return json({ error: 'No se pudo contactar la API del BCV', detail: String(e) }, 502);
  }
  if (usd == null) return json({ error: 'La API no devolvió la tasa USD del BCV' }, 502);
  usd = round2(usd);
  eur = eur != null ? round2(eur) : null;

  // 3) Guardar en historial (upsert por fecha+moneda+fuente).
  const fechasAGuardar = new Set<string>([fecha]);
  if (infoBancario.esBancario) {
    fechasAGuardar.add(fechaHoy);
  }

  const filas: Array<{ fecha: string; moneda: string; tasa: number; fuente: string }> = [];
  for (const f of fechasAGuardar) {
    filas.push({ fecha: f, moneda: 'USD', tasa: usd, fuente: 'bcv' });
    if (eur != null) filas.push({ fecha: f, moneda: 'EUR', tasa: eur, fuente: 'bcv' });
  }

  const { error: upErr } = await supabase.from('tasa_cambio').upsert(filas, { onConflict: 'fecha,moneda,fuente' });
  if (upErr) return json({ error: 'No se pudo guardar el historial', detail: upErr.message }, 500);

  // 4) Snapshot del día en config (con fecha efectiva y metadata bancaria).
  const configValue = {
    usd,
    eur,
    fecha,
    esBancario: infoBancario.esBancario,
    proximoDiaHabil: infoBancario.fecha,
    motivoBancario: infoBancario.motivo,
    fechaCalendario: fechaHoy,
  };

  await supabase.from('config').upsert(
    { key: 'tesoreria.tasa_hoy', value: configValue, updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  );

  return json({
    ok: true,
    usd,
    eur,
    fecha,
    esBancario: infoBancario.esBancario,
    proximoDiaHabil: infoBancario.fecha,
    motivoBancario: infoBancario.motivo,
    cached: false,
  });
});
