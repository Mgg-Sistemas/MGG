// MGG · Edge Function: crear-usuario
// La usa el admin o un rol con permiso de Usuarios (escritura/full) en la matriz (17-10-2026). Crea el usuario en auth.users con la clave inicial 'mgg2026'
// (must_change_password=true) e inserta su ficha en public.usuarios. Devuelve la clave
// inicial para que la pantalla la muestre.
//
// Antes era '123456': con la protección de claves filtradas de Supabase activada, Auth la
// rechaza («Password is known to be weak») y no se podía crear a nadie.

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
    return json({ error: 'Su rol no tiene permiso de Usuarios para crear usuarios' }, 403);

  // 2) Validar payload
  let payload: {
    email?: string;
    nombre?: string;
    apellido?: string;
    ci?: string;
    role?: string;
    telefono?: string;
    departamento?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Body JSON inválido' }, 400);
  }
  const { email, nombre, apellido, ci, role, telefono, departamento } = payload;
  if (!email || !/\S+@\S+\.\S+/.test(email))
    return json({ error: 'Email inválido' }, 400);
  if (!nombre || !nombre.trim()) return json({ error: 'Nombre requerido' }, 400);
  if (!role || typeof role !== 'string') return json({ error: 'Rol requerido' }, 400);

  // Validar el rol contra la tabla custom_roles (catalogo dinamico)
  const { data: roleRow, error: roleErr } = await admin
    .from('custom_roles')
    .select('key')
    .eq('key', role)
    .maybeSingle();
  if (roleErr) return json({ error: 'No se pudo validar el rol: ' + roleErr.message }, 500);
  if (!roleRow) return json({ error: `Rol "${role}" no existe en el catalogo` }, 400);
  if (!quien.esAdmin && role === 'admin')
    return json({ error: 'Solo un administrador puede crear otro administrador' }, 403);

  // 3) Crear auth user con la clave inicial
  const clave = CLAVE_INICIAL;
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: clave,
    email_confirm: true,
    user_metadata: { nombre, apellido, ci },
  });
  if (createErr || !created.user) {
    return json({ error: createErr?.message ?? 'No se pudo crear el usuario' }, 400);
  }

  // 4) Insertar/upsert en public.usuarios
  const { error: upErr } = await admin.from('usuarios').upsert(
    {
      id: created.user.id,
      email,
      nombre: nombre.trim(),
      apellido: apellido?.trim() || null,
      ci: ci?.trim() || null,
      telefono: telefono?.trim() || null,
      departamento: departamento?.trim() || null,
      role,
      estado: 'activo',
      must_change_password: true,
    },
    { onConflict: 'id' },
  );
  if (upErr) {
    // Rollback: eliminar auth user
    await admin.auth.admin.deleteUser(created.user.id);
    return json({ error: upErr.message }, 500);
  }

  return json({ ok: true, id: created.user.id, email, clave_temporal: clave });
});
