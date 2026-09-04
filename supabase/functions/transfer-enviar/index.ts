// MGG · Edge Function: transfer-enviar (proxy SALIENTE del puente inter-sistema)
// La invoca el cliente (con su JWT) para empujar al OTRO sistema:
//   - tipo 'transferencia': una transferencia nueva → POST a {INTER_DESTINO_URL}/transfer-recibir
//   - tipo 'ack':           confirmación de recepción → POST al callback del ORIGEN
// Autentica contra el otro sistema con el secreto compartido INTER_SECRET.
//
// SEGURIDAD (fix SSRF/exfiltración del secreto): el `callback_base` NUNCA se toma
// del cuerpo que manda el cliente. Para un 'ack', el destino se resuelve leyendo el
// `callback_base` que guardó `transfer-recibir` en la fila ENTRANTE correspondiente
// (por transf_id) — o sea, un origen que ya se autenticó con el secreto. Para una
// 'transferencia' saliente el destino es siempre INTER_DESTINO_URL (secreto del
// servidor). El `callback_base` que viaja en el cuerpo es SIEMPRE el nuestro.
//
// Secrets: INTER_SECRET · INTER_DESTINO_URL (base .../functions/v1 del otro sistema)
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los provee la plataforma.

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

const TABLA_POR_RECURSO: Record<string, string> = {
  dinero: 'transferencias_inter',
  combustible: 'transferencias_combustible_inter',
  casiterita: 'transferencias_casiterita_inter',
};

/** Un callback válido es una URL http(s) absoluta con host. Nada de rutas relativas ni esquemas raros. */
function callbackValido(u: string): boolean {
  return /^https?:\/\/[^/]+/i.test(u.trim());
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let payload: Record<string, unknown>;
  try { payload = await req.json(); } catch { return json({ error: 'Body JSON inválido' }, 400); }

  const secret = Deno.env.get('INTER_SECRET');
  if (!secret) return json({ entregada: false, error: 'INTER_SECRET no configurado en este sistema.' });

  const selfUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const selfBase = selfUrl ? `${selfUrl}/functions/v1` : '';

  // Resolver el destino según el tipo. El secreto SOLO se envía a destinos de confianza.
  let target: string;

  if (payload.tipo === 'ack') {
    const transfId = payload.transf_id as string | undefined;
    if (!transfId) return json({ entregada: false, error: 'transf_id requerido para el ACK.' });

    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!selfUrl || !serviceKey) return json({ entregada: false, error: 'Supabase env vars faltantes.' }, 500);
    const supabase = createClient(selfUrl, serviceKey);

    // El callback del ACK se toma de la fila ENTRANTE guardada (la escribió transfer-recibir
    // con el secreto), NO del cuerpo del cliente. Si el cliente manda recurso, se usa esa tabla;
    // si no, se buscan las tres.
    const recurso = payload.recurso === 'combustible' ? 'combustible'
      : payload.recurso === 'casiterita' ? 'casiterita'
      : payload.recurso === 'dinero' ? 'dinero' : null;
    const tablas = recurso ? [TABLA_POR_RECURSO[recurso]] : Object.values(TABLA_POR_RECURSO);

    let cbStored: string | null = null;
    for (const t of tablas) {
      const { data } = await supabase.from(t)
        .select('callback_base')
        .eq('transf_id', transfId).eq('direccion', 'entrante')
        .maybeSingle();
      const cb = (data as { callback_base?: string | null } | null)?.callback_base;
      if (cb) { cbStored = String(cb); break; }
    }
    if (!cbStored) return json({ entregada: false, error: 'No hay una transferencia entrante registrada con ese transf_id: ACK rechazado.' });
    if (!callbackValido(cbStored)) return json({ entregada: false, error: 'El callback registrado no es una URL válida.' });
    target = `${cbStored.replace(/\/+$/, '')}/transfer-recibir`;
  } else {
    const destino = Deno.env.get('INTER_DESTINO_URL');
    if (!destino) return json({ entregada: false, error: 'Destino no configurado todavía: definí INTER_DESTINO_URL al desplegar el otro sistema.' });
    target = `${destino.replace(/\/+$/, '')}/transfer-recibir`;
  }

  // El callback_base que viaja SIEMPRE es el nuestro (para que el destino sepa a quién
  // devolvernos el ACK). El valor que haya mandado el cliente se descarta.
  const body = { ...payload, callback_base: selfBase };
  let resp: Response;
  try {
    resp = await fetch(target, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-inter-secret': secret },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return json({ entregada: false, error: `No se pudo contactar al otro sistema: ${String(e)}` });
  }

  const text = await resp.text();
  if (!resp.ok) return json({ entregada: false, error: `El otro sistema respondió ${resp.status}: ${text}` });
  return json({ entregada: true, respuesta: text });
});
