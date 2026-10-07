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

/* ─── Historial de nombres (07-10-2026) ───
   Cuando a un usuario se le cambia el nombre, lo que hizo ANTES tiene que
   seguir diciendo el nombre de entonces. Los documentos ya sellan el nombre al
   nacer; las pantallas que resuelven el correo en vivo miran este historial:
   «¿cómo se llamaba este correo en tal fecha?». */

export interface CambioNombre {
  email: string;
  nombre_anterior: string;
  nombre_nuevo: string;
  motivo?: string | null;
  created_at: string;
}

/** Mapa de personas que además carga el historial de renombres (opcional). */
export type PersonasMap = Map<string, string> & { historial?: CambioNombre[] };

export async function cargarHistorialNombres(): Promise<CambioNombre[]> {
  const { data } = await supabase.from('usuarios_nombre_historial')
    .select('email, nombre_anterior, nombre_nuevo, motivo, created_at')
    .order('created_at', { ascending: true });
  return (data ?? []) as CambioNombre[];
}

/** El mapa de personas con el historial pegado, para resolver por fecha. */
export async function cargarPersonasConHistorial(): Promise<PersonasMap> {
  const [map, historial] = await Promise.all([cargarPersonasPorEmail(), cargarHistorialNombres().catch(() => [] as CambioNombre[])]);
  return Object.assign(map, { historial }) as PersonasMap;
}

/**
 * Cómo se llamaba un correo en una fecha dada. Si después de esa fecha hubo
 * renombres, vale el nombre ANTERIOR del primero de ellos; si no, el actual.
 */
export function nombreEnFecha(
  email: string | null | undefined, fecha: string | null | undefined, historial: CambioNombre[] | undefined, actual: string | null | undefined,
): string | null {
  const e = (email ?? '').trim().toLowerCase();
  if (!e || !fecha || !historial?.length) return actual ?? null;
  const t = new Date(fecha).getTime();
  if (!Number.isFinite(t)) return actual ?? null;
  const posteriores = historial
    .filter((h) => h.email.toLowerCase() === e && new Date(h.created_at).getTime() > t)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  return posteriores.length ? posteriores[0].nombre_anterior : (actual ?? null);
}

/**
 * Resuelve un correo a "Nombre Apellido"; si no hay usuario, usa el respaldo o
 * el propio correo. Con `fecha` (y un mapa con historial) devuelve el nombre
 * que la persona tenía en esa fecha.
 */
export function personaDe(email: string | null | undefined, map: PersonasMap, respaldo?: string | null, fecha?: string | null): string {
  const e = (email ?? '').trim();
  if (e) {
    const nom = nombreEnFecha(e, fecha, map.historial, map.get(e.toLowerCase()));
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
