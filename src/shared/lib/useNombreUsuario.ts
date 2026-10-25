/* ============================================================
   MGG · Correo → «Nombre Apellido» en pantalla

   Muchas filas guardan quién las hizo por su CORREO (actor, created_by…) y a
   veces el nombre sellado vino vacío o también es el correo. En pantalla se
   quiere ver a la persona, no la cuenta. Esto carga una sola vez el directorio
   de `usuarios` (con el historial de renombres) para toda la sesión y lo
   comparte entre todos los componentes; se refresca cada 10 minutos.

   Regla: si hay un NOMBRE sellado (sin «@») manda ese —es el de aquel día—; si
   lo que hay es un correo, se busca en el directorio (con `fecha`, el nombre que
   la persona tenía ese día). Si el correo no es de ningún usuario, se muestra el
   correo tal cual: es mejor que no mostrar nada.
   ============================================================ */
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { cargarPersonasConHistorial, nombreEnFecha, type PersonasMap } from './personas';

const VIGENCIA_MS = 10 * 60 * 1000;
let mapa: PersonasMap | null = null;
let cargadoEn = 0;
let pedido: Promise<void> | null = null;
const suscriptores = new Set<() => void>();

function cargar(): void {
  if (pedido) return;
  if (mapa && Date.now() - cargadoEn < VIGENCIA_MS) return;
  pedido = cargarPersonasConHistorial()
    .then((m) => { mapa = m; cargadoEn = Date.now(); suscriptores.forEach((f) => f()); })
    .catch(() => { /* sin directorio se muestra el correo, como antes */ })
    .finally(() => { pedido = null; });
}

function suscribir(f: () => void): () => void {
  suscriptores.add(f);
  return () => { suscriptores.delete(f); };
}

const esCorreo = (s: string) => s.includes('@');

/**
 * El nombre a mostrar. `nombre` es el nombre sellado (puede venir vacío o ser un
 * correo); `correo` es la cuenta. Devuelve '' si no hay nada.
 */
export function resolverNombreUsuario(
  directorio: PersonasMap | null,
  nombre?: string | null,
  correo?: string | null,
  fecha?: string | null,
): string {
  const n = (nombre ?? '').trim();
  const c = (correo ?? '').trim();
  if (n && !esCorreo(n)) return n;
  const email = esCorreo(n) ? n : c;
  if (email && esCorreo(email)) {
    const r = directorio ? nombreEnFecha(email, fecha, directorio.historial, directorio.get(email.toLowerCase())) : null;
    const limpio = (r ?? '').trim();
    return limpio || email;
  }
  return n || c;
}

/** Hook: devuelve la función `(nombre, correo?, fecha?) => «Nombre Apellido»`. */
export function useNombreUsuario(): (nombre?: string | null, correo?: string | null, fecha?: string | null) => string {
  const directorio = useSyncExternalStore(suscribir, () => mapa, () => mapa);
  useEffect(() => { cargar(); }, []);
  return useCallback(
    (nombre?: string | null, correo?: string | null, fecha?: string | null) => resolverNombreUsuario(directorio, nombre, correo, fecha),
    [directorio],
  );
}

/** Para PDF y reportes (fuera de React): espera el directorio y devuelve el resolvedor. */
export async function resolvedorNombresUsuarios(): Promise<(nombre?: string | null, correo?: string | null, fecha?: string | null) => string> {
  cargar();
  if (pedido) await pedido;
  const directorio = mapa;
  return (nombre, correo, fecha) => resolverNombreUsuario(directorio, nombre, correo, fecha);
}
