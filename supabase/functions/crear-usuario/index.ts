// MGG · Edge Function: crear-usuario
// Solo callable por admin. Crea el usuario en auth.users con una CLAVE TEMPORAL aleatoria
// (must_change_password=true) e inserta su ficha en public.usuarios. Devuelve la clave
// temporal para que el admin se la pase al usuario.
//
// Antes la clave inicial era siempre '123456': con la protección de claves filtradas de
// Supabase activada, Auth la rechaza («Password is known to be weak») y no se podía crear
// a nadie. Una clave distinta por usuario tampoco queda adivinable.

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

  // 1) Validar caller admin con su JWT
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
    return json({ error: 'Solo admin puede crear usuarios' }, 403);

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

  // 3) Crear auth user con su clave temporal
  const clave = claveTemporal();
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
