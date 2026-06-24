// MGG · Edge Function: webauthn
// Acceso biométrico (huella / Face ID / Windows Hello) vía WebAuthn / Passkeys.
// La huella NUNCA sale del dispositivo: aquí solo se guarda/verifica la clave pública.
// Acciones (body.action):
//   register-options  · (requiere JWT) genera el reto de enrolamiento del dispositivo
//   register-verify   · (requiere JWT) verifica y guarda la credencial del dispositivo
//   auth-options      · (público) genera el reto de login para un correo
//   auth-verify       · (público) verifica la firma y, si pasa, devuelve un OTP de sesión
//
// La credencial queda ATADA al dominio (rpId). El rpId/origin los manda el cliente;
// la firma WebAuthn ya está atada al origen real, así que una credencial robada en
// otro dominio no verifica contra la clave pública guardada.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  encodeBase64Url,
  decodeBase64Url,
} from 'https://deno.land/std@0.224.0/encoding/base64url.ts';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from 'https://esm.sh/@simplewebauthn/server@13.3.2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const RP_NAME = 'MGG · Mineral Group Guayana';
const CHALLENGE_TTL_MIN = 5;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/** El rpId debe ser el hostname del origen (atadura de dominio). */
function rpMatchesOrigin(rpId: string, origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    // localhost y subdominios: el rpId debe ser el host o un sufijo registrable.
    return host === rpId || host.endsWith(`.${rpId}`);
  } catch {
    return false;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !serviceKey || !anonKey) return json({ error: 'Supabase env vars faltantes' }, 500);

  const admin = createClient(url, serviceKey);

  let body: {
    action?: string;
    rpId?: string;
    origin?: string;
    email?: string;
    deviceLabel?: string;
    response?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Body JSON inválido' }, 400);
  }

  const action = body.action ?? '';
  const rpId = (body.rpId ?? '').trim();
  const origin = (body.origin ?? '').trim();
  if (!rpId || !origin || !rpMatchesOrigin(rpId, origin)) {
    return json({ error: 'Dominio (rpId/origin) inválido' }, 400);
  }

  // Caller autenticado (solo para acciones de registro).
  async function requireCaller() {
    const authHeader = req.headers.get('Authorization') ?? '';
    const callerClient = createClient(url!, anonKey!, { global: { headers: { Authorization: authHeader } } });
    const { data } = await callerClient.auth.getUser();
    return data?.user ?? null;
  }

  async function saveChallenge(email: string, kind: 'register' | 'authenticate', challenge: string, userId?: string) {
    const expires = new Date(Date.now() + CHALLENGE_TTL_MIN * 60_000).toISOString();
    // Limpia retos viejos del mismo correo+tipo y guarda el nuevo.
    await admin.from('webauthn_challenges').delete().eq('email', email).eq('kind', kind);
    await admin.from('webauthn_challenges').insert({ email, kind, challenge, user_id: userId ?? null, expires_at: expires });
  }
  async function takeChallenge(email: string, kind: 'register' | 'authenticate'): Promise<string | null> {
    const { data } = await admin
      .from('webauthn_challenges')
      .select('id, challenge, expires_at')
      .eq('email', email).eq('kind', kind)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    await admin.from('webauthn_challenges').delete().eq('id', data.id);
    if (new Date(data.expires_at).getTime() < Date.now()) return null;
    return data.challenge as string;
  }

  try {
    // ───────────── REGISTRO ─────────────
    if (action === 'register-options') {
      const caller = await requireCaller();
      if (!caller?.email) return json({ error: 'No autenticado' }, 401);

      const { data: existentes } = await admin
        .from('webauthn_credentials')
        .select('credential_id, transports')
        .eq('user_id', caller.id).eq('rp_id', rpId);

      const options = await generateRegistrationOptions({
        rpName: RP_NAME,
        rpID: rpId,
        userID: new TextEncoder().encode(caller.id),
        userName: caller.email,
        userDisplayName: caller.email,
        attestationType: 'none',
        excludeCredentials: (existentes ?? []).map((c) => ({
          id: c.credential_id as string,
          transports: c.transports ? (c.transports as string).split(',') as AuthenticatorTransportFuture[] : undefined,
        })),
        authenticatorSelection: {
          residentKey: 'preferred',
          userVerification: 'required',
          authenticatorAttachment: 'platform', // biometría del propio dispositivo
        },
      });
      await saveChallenge(caller.email, 'register', options.challenge, caller.id);
      return json({ options });
    }

    if (action === 'register-verify') {
      const caller = await requireCaller();
      if (!caller?.email) return json({ error: 'No autenticado' }, 401);
      const expectedChallenge = await takeChallenge(caller.email, 'register');
      if (!expectedChallenge) return json({ error: 'El reto expiró, intentá de nuevo' }, 400);

      const verification = await verifyRegistrationResponse({
        response: body.response as Parameters<typeof verifyRegistrationResponse>[0]['response'],
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpId,
        requireUserVerification: true,
      });
      if (!verification.verified || !verification.registrationInfo) {
        return json({ error: 'No se pudo verificar el dispositivo' }, 400);
      }
      const cred = verification.registrationInfo.credential;
      const transports = (cred.transports ?? []).join(',') || null;
      const { error: insErr } = await admin.from('webauthn_credentials').insert({
        user_id: caller.id,
        email: caller.email,
        credential_id: cred.id,
        public_key: encodeBase64Url(cred.publicKey),
        counter: cred.counter ?? 0,
        rp_id: rpId,
        transports,
        device_label: (body.deviceLabel ?? '').trim() || 'Dispositivo',
      });
      if (insErr) {
        // Credencial duplicada u otro: no es fatal para el usuario.
        if (!String(insErr.message).includes('duplicate')) return json({ error: insErr.message }, 400);
      }
      return json({ verified: true });
    }

    // ───────────── LOGIN ─────────────
    if (action === 'auth-options') {
      const email = (body.email ?? '').trim().toLowerCase();
      if (!email) return json({ error: 'Indicá el correo' }, 400);
      const { data: creds } = await admin
        .from('webauthn_credentials')
        .select('credential_id, transports')
        .eq('email', email).eq('rp_id', rpId);
      if (!creds || !creds.length) {
        return json({ error: 'Este correo no tiene huella registrada en este dispositivo/dominio' }, 404);
      }
      const options = await generateAuthenticationOptions({
        rpID: rpId,
        userVerification: 'required',
        allowCredentials: creds.map((c) => ({
          id: c.credential_id as string,
          transports: c.transports ? (c.transports as string).split(',') as AuthenticatorTransportFuture[] : undefined,
        })),
      });
      await saveChallenge(email, 'authenticate', options.challenge);
      return json({ options });
    }

    if (action === 'auth-verify') {
      const email = (body.email ?? '').trim().toLowerCase();
      if (!email) return json({ error: 'Indicá el correo' }, 400);
      const expectedChallenge = await takeChallenge(email, 'authenticate');
      if (!expectedChallenge) return json({ error: 'El reto expiró, intentá de nuevo' }, 400);

      const resp = body.response as { id?: string };
      const { data: cred } = await admin
        .from('webauthn_credentials')
        .select('*')
        .eq('email', email).eq('rp_id', rpId).eq('credential_id', resp?.id ?? '')
        .maybeSingle();
      if (!cred) return json({ error: 'Credencial no encontrada' }, 404);

      const verification = await verifyAuthenticationResponse({
        response: body.response as Parameters<typeof verifyAuthenticationResponse>[0]['response'],
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpId,
        requireUserVerification: true,
        credential: {
          id: cred.credential_id as string,
          publicKey: decodeBase64Url(cred.public_key as string),
          counter: Number(cred.counter) || 0,
          transports: cred.transports ? (cred.transports as string).split(',') as AuthenticatorTransportFuture[] : undefined,
        },
      });
      if (!verification.verified) return json({ error: 'La huella no coincide' }, 401);

      // Actualiza el contador anti-clonación y la fecha de uso.
      await admin.from('webauthn_credentials')
        .update({ counter: verification.authenticationInfo.newCounter, last_used_at: new Date().toISOString() })
        .eq('id', cred.id);

      // Verificación OK → emitimos un OTP de un solo uso para abrir la sesión de Supabase.
      // generateLink NO envía correo: solo devuelve el OTP que el cliente canjea.
      const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
      if (linkErr || !link?.properties?.email_otp) {
        return json({ error: linkErr?.message ?? 'No se pudo abrir la sesión' }, 500);
      }
      return json({ verified: true, email, otp: link.properties.email_otp });
    }

    return json({ error: `Acción desconocida: ${action}` }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Error inesperado' }, 500);
  }
});

type AuthenticatorTransportFuture = 'ble' | 'cable' | 'hybrid' | 'internal' | 'nfc' | 'smart-card' | 'usb';
