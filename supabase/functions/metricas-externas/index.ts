// MGG · Edge Function: metricas-externas (PULL del puente inter-sistema)
// Lee una MÉTRICA de OTRO sistema (otro Supabase) y la devuelve resuelta, sin
// exponer credenciales del otro sistema al navegador. El front la invoca con su
// JWT: { sistema, metrica } → { valor }.
//
// Hoy soporta:
//   sistema 'golden-touch' · metrica 'acopio_saldo_kg'  (Saldo en Kg del acopio GT)
//
// Para sumar una métrica nueva: agregá su RPC en el sistema destino y mapealo
// abajo en FUENTES[sistema].metricas. Para conectar otro sistema: agregá su
// entrada con sus secretos {URL}/{SERVICE_KEY}.
//
// Secrets en MGG:
//   GT_URL          → https://<ref-de-golden-touch>.supabase.co
//   GT_SERVICE_KEY  → service_role de Golden Touch (NUNCA viaja al cliente)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// Registro de sistemas externos y sus métricas (métrica → nombre del RPC remoto).
const FUENTES: Record<string, { url: () => string | undefined; key: () => string | undefined; metricas: Record<string, string> }> = {
  'golden-touch': {
    url: () => Deno.env.get('GT_URL'),
    key: () => Deno.env.get('GT_SERVICE_KEY'),
    metricas: {
      acopio_saldo_kg: 'metrica_acopio_saldo_kg',
      acopio_saldo_usd: 'metrica_acopio_saldo_usd',
      acopio_tasa_material: 'metrica_acopio_tasa_material',
    },
  },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let payload: { sistema?: string; metrica?: string };
  try { payload = await req.json(); } catch { return json({ error: 'Body JSON inválido' }, 400); }

  const sistema = String(payload.sistema ?? '').trim();
  const metrica = String(payload.metrica ?? '').trim();
  const fuente = FUENTES[sistema];
  if (!fuente) return json({ error: `Sistema externo desconocido: ${sistema || '(vacío)'}` }, 400);
  const rpc = fuente.metricas[metrica];
  if (!rpc) return json({ error: `Métrica desconocida para ${sistema}: ${metrica || '(vacía)'}` }, 400);

  const url = fuente.url();
  const key = fuente.key();
  if (!url || !key) return json({ error: `El sistema "${sistema}" no está configurado todavía (faltan secretos en el servidor).` }, 503);

  let resp: Response;
  try {
    resp = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/rpc/${rpc}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: '{}',
    });
  } catch (e) {
    return json({ error: `No se pudo contactar al sistema externo: ${String(e)}` }, 502);
  }

  const text = await resp.text();
  if (!resp.ok) return json({ error: `El sistema externo respondió ${resp.status}: ${text}` }, 502);

  const valor = Number(typeof text === 'string' ? text.trim() : text);
  if (!Number.isFinite(valor)) return json({ error: `Respuesta no numérica del sistema externo: ${text}` }, 502);

  return json({ valor, sistema, metrica, at: new Date().toISOString() });
});
