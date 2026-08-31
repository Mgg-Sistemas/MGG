import { useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '@/shared/lib/supabase';

/** Los roles son dinámicos (custom_roles). Se exporta como string para no restringir nuevos valores. */
export type Role = string;

export interface AppUser {
  id: string;
  email: string;
  nombre: string;
  role: Role;
  ci?: string | null;
  /** Sectorización de almacén (ver `modules/inventario/sectorizacion.ts`). */
  sedes_asignadas?: string[] | null;
  almacen_recepcion?: string | null;
}

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      // Al volver el foco a la pestaña, Supabase refresca el token y emite
      // TOKEN_REFRESHED con un `session` NUEVO. Si lo propagáramos, cambiaría la
      // identidad de `user` → PermissionsContext recargaría con "Cargando…" y
      // desmontaría la vista (cerrando cualquier modal abierto). Solo
      // actualizamos cuando cambia el usuario (login/logout), no en refrescos.
      setSession((prev) => (prev?.user?.id === s?.user?.id ? prev : s));
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  return { session, loading, user: session?.user ?? null };
}

export async function signIn(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signOut() {
  return supabase.auth.signOut();
}

/** Cierra sesión solo del lado del cliente (limpia storage). Sin round-trip al servidor:
 *  ~5–10× más rápido que `signOut()`, usado al entrar al login para "siempre logearse". */
export async function signOutLocal() {
  return supabase.auth.signOut({ scope: 'local' });
}

export async function getAppUser(user: User): Promise<AppUser | null> {
  // Las columnas de sectorización son nuevas: si el build llega a un entorno donde
  // todavía no se corrió la migración, PostgREST devuelve error 42703 y el usuario
  // no podría ni entrar. Por eso se reintenta sin ellas en vez de fallar.
  const CON_SECTOR = 'id, email, nombre, role, ci, sedes_asignadas, almacen_recepcion';
  const { data, error } = await supabase
    .from('usuarios')
    .select(CON_SECTOR)
    .eq('id', user.id)
    .single();
  if (!error) return data as AppUser;

  const { data: base, error: eBase } = await supabase
    .from('usuarios')
    .select('id, email, nombre, role, ci')
    .eq('id', user.id)
    .single();
  if (eBase) return null;
  return base as AppUser;
}
