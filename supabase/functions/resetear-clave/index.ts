// MGG · Edge Function: resetear-clave
// La usa el admin o un rol con permiso de Usuarios (escritura/full) en la matriz (17-10-2026). Resetea la clave del usuario objetivo a la inicial 'mgg2026', marca
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

/** Quién puede usar esta función: el rol admin, o un rol con permiso de Usuarios
 *  (escritura o full) en la matriz de Roles y Permisos; siempre con estado activo.
 *  Quien no es admin nunca actúa sobre una cuenta admin ni asigna el rol admin
 *  (17-10-2026, orden de la administradora: antes era solo admin y los roles con
 *  "full control" no podían hacer nada en Usuarios). */
async function permisoUsuarios(admin: ReturnType<typeof createClient>, callerId: string) {
  const { data: callerRow } = await admin
    .from('usuarios')
    .select('role, estado')
    .eq('id', callerId)
    .maybeSingle();
  if (!callerRow || callerRow.estado !== 'activo') return { ok: false, esAdmin: false };
  if (callerRow.role === 'admin') return { ok: true, esAdmin: true };
  const { data: perm } = await admin
    .from('roles_permisos')
    .select('permisos')
    .eq('role', callerRow.role)
    .maybeSingle();
  const u = (perm?.permisos as Record<string, { escritura?: boolean; full?: boolean }> | null)?.usuarios;
  return { ok: !!(u?.full || u?.escritura), esAdmin: false };
}

/** true si la cuenta objetivo es admin (quien no es admin no la puede tocar). */
async function objetivoEsAdmin(admin: ReturnType<typeof createClient>, targetId: string) {
  const { data } = await admin.from('usuarios').select('role').eq('id', targetId).maybeSingle();
  return data?.role === 'admin';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !serviceKey || !anonKey)
    return json({ error: 'Supabase env vars faltantes' }, 500);

  // 1) Validar quién llama (admin o permiso de Usuarios)
  const authHeader = req.headers.get('Authorization') ?? '';
  const callerClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: caller } = await callerClient.auth.getUser();
  if (!caller?.user) return json({ error: 'No autenticado' }, 401);

  const admin = createClient(url, serviceKey);
  const quien = await permisoUsuarios(admin, caller.user.id);
  if (!quien.ok)
    return json({ error: 'Su rol no tiene permiso de Usuarios para resetear claves' }, 403);

  // 2) Validar payload
  let payload: { user_id?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Body JSON inválido' }, 400);
  }
  const targetId = payload.user_id;
  if (!targetId) return json({ error: 'user_id requerido' }, 400);
  if (!quien.esAdmin && (await objetivoEsAdmin(admin, targetId)))
    return json({ error: 'Solo un administrador puede resetear la clave de otro administrador' }, 403);

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
