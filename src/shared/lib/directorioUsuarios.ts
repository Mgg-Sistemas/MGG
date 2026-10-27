/* ============================================================
   Golden Touch · Quién hizo qué: nombre y apellido en vez del correo (25/10/2026)

   Muchas tablas guardan solo el correo de quien hizo el movimiento (created_by,
   actor, creado_por…) y otras guardan además el nombre de pila (actor_name).
   Las pantallas deben mostrar SIEMPRE «Nombre Apellido»; aquí se carga el
   directorio de personas (correo → nombre y apellido, vía la función segura
   `obtener_directorio_personas`, legible por cualquier usuario con sesión) y se
   resuelve cada valor.

   Regla de `nombreVisible(guardado, correo)`:
   - Si el nombre guardado es el comienzo del nombre completo de ese correo
     (ej. guardó «ANGELICA» y el directorio dice «ANGELICA SOLIS») se muestra
     el completo.
   - Si el nombre guardado es otro (la persona cambió de nombre después), se
     respeta el guardado: lo que se hizo antes sigue con el nombre de entonces.
   - Si solo hay correo, se muestra el nombre del directorio; si el correo no
     está en el directorio, se muestra el correo tal cual (como antes).
   ============================================================ */
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { supabase } from './supabase';

export type Directorio = Map<string, string>;

const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const esCorreo = (s: string) => s.includes('@');

/** «Nombre Apellido» a partir de las columnas de la tabla de usuarios. */
export const nombreYApellido = (nombre?: string | null, apellido?: string | null): string =>
  [nombre, apellido].map((x) => (x ?? '').trim()).filter(Boolean).join(' ');

/**
 * Qué mostrar para quien hizo algo. `guardado` es el nombre que quedó anotado junto
 * al registro (actor_name, created_by_name…; puede venir vacío o ser un correo) y
 * `correo` su correo (created_by, actor…). Devuelve '' si no hay nada que mostrar.
 */
export function nombreVisible(
  guardado: string | null | undefined,
  correo: string | null | undefined,
  directorio: Directorio,
): string {
  const g = (guardado ?? '').trim();
  const c = (correo ?? '').trim();
  const mail = c && esCorreo(c) ? c : g && esCorreo(g) ? g : '';
  const nombreGuardado = g && !esCorreo(g) ? g : '';
  const completo = mail ? directorio.get(mail.toLowerCase()) : undefined;

  if (nombreGuardado) {
    if (!completo) return nombreGuardado;
    const a = norm(nombreGuardado);
    const b = norm(completo);
    return b.startsWith(a) ? completo : nombreGuardado;
  }
  if (completo) return completo;
  // Sin correo ni nombre guardado: si `correo` es otro texto (ej. «sistema»), tal cual.
  return mail || c || g;
}

/* ───────────── Directorio compartido (una sola carga para toda la app) ───────────── */

let directorio: Directorio = new Map();
let version = 0;
let cargadoEn = 0;
let enCurso: Promise<void> | null = null;
const oyentes = new Set<() => void>();

const TTL_MS = 5 * 60_000;

interface FilaDirectorio { email: string | null; nombre: string | null; apellido: string | null }

/** Carga (o refresca) el directorio. Seguro de llamar muchas veces: comparte la carga en curso. */
export function cargarDirectorioUsuarios(forzar = false): Promise<void> {
  if (enCurso) return enCurso;
  if (!forzar && cargadoEn && Date.now() - cargadoEn < TTL_MS) return Promise.resolve();
  enCurso = (async () => {
    try {
      const { data, error } = await supabase.rpc('obtener_directorio_personas');
      if (error) throw error;
      const mapa: Directorio = new Map();
      for (const u of (data ?? []) as FilaDirectorio[]) {
        const nom = nombreYApellido(u.nombre, u.apellido);
        if (u.email && nom) mapa.set(u.email.toLowerCase().trim(), nom);
      }
      directorio = mapa;
      cargadoEn = Date.now();
      version += 1;
      oyentes.forEach((f) => f());
    } catch {
      // Sin directorio se sigue mostrando lo guardado / el correo, como antes.
    } finally {
      enCurso = null;
    }
  })();
  return enCurso;
}

const suscribir = (f: () => void) => { oyentes.add(f); return () => { oyentes.delete(f); }; };
const leerVersion = () => version;

/**
 * Para pantallas: devuelve `quien(guardado, correo?)` → «Nombre Apellido» y se vuelve
 * a pintar sola cuando el directorio termina de cargar.
 *   quien(x.actor_name, x.actor)        ·   quien(x.created_by)
 */
export function useQuien(): (guardado: string | null | undefined, correo?: string | null) => string {
  const v = useSyncExternalStore(suscribir, leerVersion);
  useEffect(() => { void cargarDirectorioUsuarios(); }, []);
  // `v` cambia cuando llega el directorio: el callback nuevo vuelve a pintar a quien lo use.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback((guardado, correo) => nombreVisible(guardado, correo, directorio), [v]);
}

/**
 * Para PDF, Excel y otro código que no es un componente: resuelve al instante con el
 * directorio ya cargado (la app lo carga al abrir sesión). Si aún no llegó, devuelve
 * lo guardado / el correo, como antes.
 */
export const quienSync = (guardado: string | null | undefined, correo?: string | null): string =>
  nombreVisible(guardado, correo, directorio);

/** Igual que `quienSync` pero espera a que el directorio esté cargado. */
export async function resolverQuien(): Promise<(guardado: string | null | undefined, correo?: string | null) => string> {
  await cargarDirectorioUsuarios();
  const d = directorio;
  return (guardado, correo) => nombreVisible(guardado, correo, d);
}
