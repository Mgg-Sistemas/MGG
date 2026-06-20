import { supabase } from './supabase';

/**
 * Mapa email (minúscula) → "Nombre Apellido" desde la tabla `usuarios`.
 * Lo usan los PDF/reportes para mostrar la persona en vez del correo.
 */
export async function cargarPersonasPorEmail(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const { data } = await supabase.from('usuarios').select('email, nombre, apellido');
  (data ?? []).forEach((u) => {
    const email = (u.email as string | null)?.toLowerCase();
    if (!email) return;
    const nom = `${u.nombre ?? ''} ${u.apellido ?? ''}`.trim();
    map.set(email, nom || email);
  });
  return map;
}

/** Resuelve un correo a "Nombre Apellido"; si no hay usuario, usa el respaldo o el propio correo. */
export function personaDe(email: string | null | undefined, map: Map<string, string>, respaldo?: string | null): string {
  const e = (email ?? '').trim();
  if (e) {
    const nom = map.get(e.toLowerCase());
    if (nom) return nom;
  }
  return (respaldo && respaldo.trim()) || e || '—';
}
