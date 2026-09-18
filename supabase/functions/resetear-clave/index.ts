// MGG · Edge Function: resetear-clave
// Solo admin. Pone al usuario objetivo una CLAVE TEMPORAL aleatoria, marca
// must_change_password=true para forzar el cambio en el próximo login y devuelve
// la clave temporal para que el admin se la pase.
//
// Antes reseteaba siempre a '123456': con la protección de claves filtradas de
// Supabase activada, Auth la rechaza («Password is known to be weak»).

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** Clave temporal legible: Mgg-XXXX-0000 (sin letras que se confunden: I, l, O, 0…). */
function claveTemporal(): string {
  const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
  const rnd = new Uint32Array(8);
  crypto.getRandomValues(rnd);
  const parte = Array.from(rnd.slice(0, 4), (n) => letras[n % letras.length]).join('');
  const num = Array.from(rnd.slice(4), (n) => String(2 + (n % 8))).join('');
  return `Mgg-${parte}-${num}`;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !serviceKey || !anonKey)
    return json({ error: 'Supabase env vars faltantes' }, 500);

  // 1) Validar caller admin
  const authHeader = req.headers.get('Authorization') ?? '';
  const callerClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: caller } = await callerClient.auth.getUser();
  if (!caller?.user) return json({ error: 'No autenticado' }, 401);

  const admin = createClient(url, serviceKey);
  const { data: callerRow } = await admin
    .from('usuarios')
    .select('role')
    .eq('id', caller.user.id)
    .maybeSingle();
  if (!callerRow || callerRow.role !== 'admin')
    return json({ error: 'Solo admin puede resetear claves' }, 403);

  // 2) Validar payload
  let payload: { user_id?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Body JSON inválido' }, 400);
  }
  const targetId = payload.user_id;
  if (!targetId) return json({ error: 'user_id requerido' }, 400);

  // 3) Resetear a una clave temporal nueva
  const clave = claveTemporal();
  const { error: pwErr } = await admin.auth.admin.updateUserById(targetId, {
    password: clave,
  });
  if (pwErr) return json({ error: pwErr.message }, 400);

  // 4) Forzar cambio en proximo login
  const { error: flagErr } = await admin
    .from('usuarios')
    .update({ must_change_password: true })
    .eq('id', targetId);
  if (flagErr) return json({ error: flagErr.message }, 500);

  return json({ ok: true, clave_temporal: clave });
});
