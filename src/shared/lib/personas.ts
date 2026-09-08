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
/**
 * Nombre de una persona leído en el momento, para SELLARLO en un documento que
 * nace. Los papeles ya cerrados (una orden, una salida) tienen que decir quién
 * los pidió el día que se pidieron: si mañana esa persona se renombra, el
 * documento viejo no puede cambiar de firmante.
 */
export async function nombrePorEmail(email: string | null | undefined): Promise<string | null> {
  const e = (email ?? '').trim();
  if (!e) return null;
  // `ilike` sin comodines = igualdad sin distinguir mayúsculas, que es como se
  // cargan los correos en la práctica.
  const { data } = await supabase
    .from('usuarios')
    .select('nombre, apellido')
    .ilike('email', e)
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return `${data.nombre ?? ''} ${data.apellido ?? ''}`.trim() || null;
}

/**
 * Qué nombre se sella al crear un documento: manda lo que escribió el usuario,
 * y si lo dejó vacío se usa el nombre que tiene hoy en su ficha. Vacío solo si
 * no hay ninguno de los dos.
 */
export function nombreASellar(escrito: string | null | undefined, resuelto: string | null | undefined): string | null {
  const e = (escrito ?? '').trim();
  if (e) return e;
  return (resuelto ?? '').trim() || null;
}
