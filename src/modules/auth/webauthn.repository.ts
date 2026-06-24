/* ============================================================
   MGG · Acceso biométrico (WebAuthn / Passkeys)
   La huella/Face ID/Windows Hello NUNCA sale del dispositivo: el
   navegador delega en el autenticador del equipo y solo intercambia
   una firma criptográfica. La credencial queda ATADA al dominio
   (rpId = hostname actual): enrolada en un equipo+dominio, sirve
   solo ahí. El login con clave siempre queda como respaldo.
   ============================================================ */
import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
} from '@simplewebauthn/browser';
import { supabase } from '@/shared/lib/supabase';

/** rpId = dominio actual (sin puerto). origin = origen completo. */
function rp() {
  return { rpId: window.location.hostname, origin: window.location.origin };
}

/** Etiqueta legible del dispositivo (para distinguir credenciales). */
function deviceLabel(): string {
  const ua = navigator.userAgent;
  let so = 'Dispositivo';
  if (/Windows/i.test(ua)) so = 'Windows';
  else if (/Android/i.test(ua)) so = 'Android';
  else if (/iPhone|iPad|iPod/i.test(ua)) so = 'iPhone/iPad';
  else if (/Mac/i.test(ua)) so = 'Mac';
  else if (/Linux/i.test(ua)) so = 'Linux';
  const navInfo = /Edg/i.test(ua) ? 'Edge' : /Chrome/i.test(ua) ? 'Chrome' : /Firefox/i.test(ua) ? 'Firefox' : /Safari/i.test(ua) ? 'Safari' : '';
  return navInfo ? `${so} · ${navInfo}` : so;
}

/** ¿El navegador/equipo soporta acceso biométrico de plataforma (huella, Hello…)? */
export async function biometriaDisponible(): Promise<boolean> {
  try {
    if (!browserSupportsWebAuthn()) return false;
    return await platformAuthenticatorIsAvailable();
  } catch {
    return false;
  }
}

async function invoke<T>(action: string, extra: Record<string, unknown>): Promise<T> {
  const { rpId, origin } = rp();
  const { data, error } = await supabase.functions.invoke('webauthn', {
    body: { action, rpId, origin, ...extra },
  });
  if (error) {
    // El cuerpo de error de la función trae el mensaje real.
    let msg = error.message ?? 'Error de red';
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === 'function') {
        const j = await ctx.json();
        if (j?.error) msg = j.error;
      }
    } catch { /* sin cuerpo */ }
    throw new Error(msg);
  }
  const d = data as { error?: string } & T;
  if (d && d.error) throw new Error(d.error);
  return d as T;
}

/**
 * Enrola la huella del dispositivo actual para el usuario logueado.
 * Requiere sesión activa (el JWT viaja en la llamada a la Edge Function).
 */
export async function registrarBiometria(): Promise<void> {
  if (!(await biometriaDisponible())) {
    throw new Error('Este equipo no tiene un sensor biométrico compatible (huella / Windows Hello / Face ID).');
  }
  const { options } = await invoke<{ options: Parameters<typeof startRegistration>[0]['optionsJSON'] }>(
    'register-options', { deviceLabel: deviceLabel() },
  );
  const att = await startRegistration({ optionsJSON: options });
  await invoke('register-verify', { response: att, deviceLabel: deviceLabel() });
}

/**
 * Inicia sesión con la huella del dispositivo para `email`. Verifica la firma
 * en el servidor y, si pasa, canjea el OTP para abrir la sesión de Supabase.
 */
export async function entrarConBiometria(email: string): Promise<void> {
  const correo = email.trim().toLowerCase();
  if (!correo) throw new Error('Indicá tu correo.');
  if (!browserSupportsWebAuthn()) throw new Error('Este navegador no soporta acceso biométrico.');

  const { options } = await invoke<{ options: Parameters<typeof startAuthentication>[0]['optionsJSON'] }>(
    'auth-options', { email: correo },
  );
  const asr = await startAuthentication({ optionsJSON: options });
  const { otp } = await invoke<{ otp: string }>('auth-verify', { email: correo, response: asr });

  const { error } = await supabase.auth.verifyOtp({ email: correo, token: otp, type: 'email' });
  if (error) throw new Error(error.message ?? 'No se pudo abrir la sesión.');
}

export interface CredencialBiometrica {
  id: string;
  device_label: string | null;
  rp_id: string;
  created_at: string;
  last_used_at: string | null;
}

/** Credenciales biométricas del usuario actual (para administrarlas). */
export async function listarCredenciales(): Promise<CredencialBiometrica[]> {
  const { data, error } = await supabase
    .from('webauthn_credentials')
    .select('id, device_label, rp_id, created_at, last_used_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as CredencialBiometrica[];
}

/** Elimina una credencial (deja de servir esa huella/dispositivo). */
export async function eliminarCredencial(id: string): Promise<void> {
  const { error } = await supabase.from('webauthn_credentials').delete().eq('id', id);
  if (error) throw error;
}

/** ¿El correo tiene alguna huella registrada en ESTE dominio? (para mostrar el botón en login). */
export async function tieneBiometriaEnDominio(): Promise<boolean> {
  // No hay forma anónima de saberlo sin exponer datos; el botón se muestra siempre
  // que el navegador soporte WebAuthn y el usuario decide. Esta función queda por si
  // luego se quiere precargar. Devuelve el soporte del navegador.
  return browserSupportsWebAuthn();
}
