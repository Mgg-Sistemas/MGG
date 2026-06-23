/* ============================================================
   MGG · Usuarios · Sesiones / actividad (Supabase)
   Registra cada conexión (inicio, latido, cierre) para la
   supervisión: quién está conectado y cuánto tiempo dura en
   el sistema. Lo alimenta AppShell (start/heartbeat/end).
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';

export interface UserSession {
  id: string;
  usuario_id: string | null;
  email: string | null;
  nombre: string | null;
  started_at: string;
  last_seen_at: string;
  ended_at: string | null;
  user_agent: string | null;
}

const SS_KEY = 'mgg_session_id';
/** Minutos sin latido tras los cuales se considera que el usuario ya no está conectado. */
export const CONECTADO_MINUTOS = 5;

/** Inicia una sesión para el usuario actual y guarda su id en sessionStorage. */
export async function startSession(): Promise<string | null> {
  const { data: u } = await supabase.auth.getUser();
  const user = u?.user;
  if (!user) return null;
  let nombre: string | null = null;
  try {
    const { data } = await supabase.from('usuarios').select('nombre').eq('id', user.id).single();
    nombre = (data as { nombre?: string } | null)?.nombre ?? null;
  } catch { /* nombre opcional */ }
  const { data, error } = await supabase
    .from('user_sessions')
    .insert({ usuario_id: user.id, email: user.email ?? null, nombre, user_agent: navigator.userAgent.slice(0, 300) })
    .select('id')
    .single();
  if (error) return null;
  const id = (data as { id: string }).id;
  try { sessionStorage.setItem(SS_KEY, id); } catch { /* ignore */ }
  return id;
}

/** Devuelve la sesión vigente (de sessionStorage) o crea una nueva si no hay. */
export async function ensureSession(): Promise<string | null> {
  let id: string | null = null;
  try { id = sessionStorage.getItem(SS_KEY); } catch { /* ignore */ }
  if (id) return id;
  return startSession();
}

/** Marca actividad (último latido). Se llama periódicamente. */
export async function heartbeat(id: string): Promise<void> {
  await supabase.from('user_sessions').update({ last_seen_at: new Date().toISOString() }).eq('id', id);
}

/** Cierra la sesión (al cerrar sesión o salir). */
export async function endSession(id: string): Promise<void> {
  const now = new Date().toISOString();
  await supabase.from('user_sessions').update({ ended_at: now, last_seen_at: now }).eq('id', id);
  try { sessionStorage.removeItem(SS_KEY); } catch { /* ignore */ }
}

/** Usuarios conectados AHORA: sesión abierta y con latido reciente. */
export async function listConectadosAhora(minutos = CONECTADO_MINUTOS): Promise<UserSession[]> {
  const desde = new Date(Date.now() - minutos * 60_000).toISOString();
  const { data, error } = await supabase
    .from('user_sessions')
    .select('*')
    .is('ended_at', null)
    .gte('last_seen_at', desde)
    .order('started_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as UserSession[];
}

/** Sesiones iniciadas dentro de un período (para el resumen de actividad). */
export async function listSesiones(desde: string, hasta: string): Promise<UserSession[]> {
  const desdeISO = `${desde}T00:00:00`;
  const hastaISO = `${hasta}T23:59:59.999`;
  const { data, error } = await supabase
    .from('user_sessions')
    .select('*')
    .gte('started_at', desdeISO)
    .lte('started_at', hastaISO)
    .order('started_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as UserSession[];
}
