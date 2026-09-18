// MGG · Edge Function: resetear-clave
// Solo admin. Resetea la clave del usuario objetivo a la inicial 'mgg2026', marca
// must_change_password=true para forzar el cambio en el próximo login y la devuelve.
//
// Antes reseteaba a '123456': con la protección de claves filtradas de Supabase
// activada, Auth la rechaza («Password is known to be weak»).

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** Clave inicial fija. Tiene que ser una que NO figure en las listas de claves filtradas
 *  (HaveIBeenPwned): con esa protección activada, Auth rechaza 123456 / 654321. Verificada
 *  el 18-09-2026. El usuario queda obligado a cambiarla en su primer ingreso. */
const CLAVE_INICIAL = 'mgg2026';

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

  // 3) Resetear a la clave inicial
  const clave = CLAVE_INICIAL;
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
