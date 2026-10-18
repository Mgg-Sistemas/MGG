// MGG · Edge Function: cambiar-correo
// La usa el admin o un rol con permiso de Usuarios (escritura/full) en la matriz (17-10-2026). Cambia el correo de un usuario tanto en Auth (identidad de login)
// como en la tabla `usuarios`, en una sola operación. El correo queda confirmado
// (email_confirm) para que el usuario pueda entrar de inmediato con el nuevo.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    return json({ error: 'Su rol no tiene permiso de Usuarios para cambiar el correo' }, 403);

  // 2) Validar payload
  let payload: { user_id?: string; email?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Body JSON inválido' }, 400);
  }
  const targetId = payload.user_id;
  const email = (payload.email ?? '').trim().toLowerCase();
  if (!targetId) return json({ error: 'user_id requerido' }, 400);
  if (!email || !EMAIL_RE.test(email)) return json({ error: 'Correo inválido' }, 400);
  if (!quien.esAdmin && (await objetivoEsAdmin(admin, targetId)))
    return json({ error: 'Solo un administrador puede cambiar el correo de otro administrador' }, 403);

  // 3) Evitar duplicados: que no exista otro usuario con ese correo
  const { data: dup } = await admin
    .from('usuarios')
    .select('id')
    .eq('email', email)
    .neq('id', targetId)
    .maybeSingle();
  if (dup) return json({ error: 'Ya existe un usuario con ese correo' }, 409);

  // 4) Cambiar el correo en Auth (confirmado) y en la tabla `usuarios`
  const { error: authErr } = await admin.auth.admin.updateUserById(targetId, {
    email,
    email_confirm: true,
  });
  if (authErr) return json({ error: authErr.message }, 400);

  const { error: dbErr } = await admin
    .from('usuarios')
    .update({ email, updated_at: new Date().toISOString() })
    .eq('id', targetId);
  if (dbErr) return json({ error: dbErr.message }, 500);

  return json({ ok: true, email });
});
