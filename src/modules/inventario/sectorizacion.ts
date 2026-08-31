/* ============================================================
   MGG · Inventario · sectorización de almacenistas
   Un almacenista trabaja en SU sede. Puede VER el inventario completo
   (necesita saber si un repuesto está en la otra sede), pero solo puede
   MOVER lo que está en sus almacenes: despachar, trasladar, ajustar,
   recibir compras y dar de alta productos. Lo que está en otra sede se
   pide por SOLICITUD DE TRASLADO, que es el camino que deja rastro.

   La asignación vive en `usuarios.sedes_asignadas` (texto, mismo valor que
   `almacenes.sede`) y se edita en Usuarios. Antes estaba cableada en un
   mapa por correo dentro del código y solo la consultaban 2 de los 7
   caminos que mueven stock: por eso los almacenistas venían despachando
   ítems de la otra sede por error humano.

   `null` o arreglo vacío = SIN restricción (admin, analistas, gerencia).
   Acá viven las piezas puras: se testean sin base ni React.
   ============================================================ */

import type { Almacen } from '@/shared/lib/types';

/** Lo mínimo que hace falta de un usuario para decidir su sector. */
export interface UsuarioSectorizable {
  email?: string | null;
  sedes_asignadas?: string[] | null;
  almacen_recepcion?: string | null;
}

/** Etiqueta de los almacenes sin sede cargada (misma que usa `AlmacenPicker`). */
export const SIN_SEDE = 'Sin sede';

/**
 * Respaldo mientras la asignación no esté cargada en la base. Son los dos
 * almacenistas que estaban cableados por correo antes de la migración: sin esto,
 * el día que se despliegue el build y antes de correr el SQL, ISNER y KELVIN
 * quedarían sin restricción. Se retira cuando todos los almacenistas tengan su
 * fila cargada (la base SIEMPRE manda sobre este mapa).
 */
export const RESPALDO_POR_CORREO: Record<string, { sedes: string[]; almacenRecepcion: string }> = {
  // ISNER → Los Pinos
  'almacen.pzo.lospinos@gmail.com': { sedes: ['LOS PINOS'], almacenRecepcion: 'Los Pinos' },
  // KELVIN → Matanzas (recibe en el almacén "General")
  'almacenmatanzas2026@gmail.com': { sedes: ['CENTRO DE FUNDICION - MATANZAS'], almacenRecepcion: 'General' },
};

/** Normaliza una lista de sedes: recorta, descarta vacíos y deduplica. */
function limpiarSedes(sedes: readonly (string | null | undefined)[] | null | undefined): string[] {
  const out: string[] = [];
  for (const s of sedes ?? []) {
    const v = String(s ?? '').trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

/**
 * Sedes en las que este usuario puede MOVER. `null` = sin restricción.
 * La base manda; el mapa por correo solo cubre a quien todavía no la tenga cargada.
 */
export function sedesDeUsuario(u: UsuarioSectorizable | null | undefined): string[] | null {
  if (!u) return null;
  const enBase = limpiarSedes(u.sedes_asignadas);
  if (enBase.length) return enBase;
  // Un ARREGLO VACÍO es una decisión explícita: «este usuario no tiene restricción».
  // Solo cuando la columna está en null (nunca se configuró) entra el respaldo por
  // correo. Sin esta distinción, un admin destildaba todas las sedes de ISNER, guardaba,
  // y el mapa cableado se las volvía a poner: la restricción no se podía levantar.
  if (Array.isArray(u.sedes_asignadas)) return null;
  const respaldo = RESPALDO_POR_CORREO[(u.email ?? '').toLowerCase().trim()];
  return respaldo ? [...respaldo.sedes] : null;
}

/** ¿Este usuario está sectorizado (le aplica la restricción)? */
export function estaSectorizado(u: UsuarioSectorizable | null | undefined): boolean {
  return sedesDeUsuario(u) !== null;
}

/** Sede a la que pertenece un almacén, por NOMBRE (así se referencia en 11 tablas). */
export function sedeDeAlmacen(nombre: string | null | undefined, almacenes: Almacen[]): string | null {
  const n = String(nombre ?? '').trim();
  if (!n) return null;
  const a = almacenes.find((x) => x.nombre === n);
  if (!a) return null;
  return a.sede?.trim() || SIN_SEDE;
}

/** ¿Puede mover en esta sede? */
export function puedeMoverEnSede(sede: string | null | undefined, sedes: string[] | null): boolean {
  if (!sedes) return true;                       // usuario sin restricción
  const s = String(sede ?? '').trim();
  if (!s) return false;                          // sede desconocida bajo restricción: no se permite
  return sedes.includes(s);
}

/**
 * ¿Puede mover en este almacén? Un almacén que NO está en la tabla (nombre legado,
 * ej. el viejo "General" suelto) se trata como desconocido: bajo restricción se
 * bloquea, porque no hay forma de saber de qué sede es.
 */
export function puedeMoverEnAlmacen(
  nombre: string | null | undefined,
  almacenes: Almacen[],
  sedes: string[] | null,
): boolean {
  if (!sedes) return true;
  return puedeMoverEnSede(sedeDeAlmacen(nombre, almacenes), sedes);
}

/**
 * Mensaje en español de por qué no se puede mover ahí, o `null` si sí se puede.
 * Se muestra junto al botón «Solicitar traslado»: la idea no es esconder el
 * almacén ajeno, es explicar por dónde se pide.
 */
export function motivoAlmacenAjeno(
  nombre: string | null | undefined,
  almacenes: Almacen[],
  sedes: string[] | null,
): string | null {
  if (puedeMoverEnAlmacen(nombre, almacenes, sedes)) return null;
  const n = String(nombre ?? '').trim() || 'ese almacén';
  const sede = sedeDeAlmacen(nombre, almacenes);
  const mias = (sedes ?? []).join(', ') || '—';
  return sede
    ? `«${n}» es de ${sede} y vos tenés asignado ${mias}. Para mover ese material, pedí un traslado.`
    : `No se pudo determinar la sede de «${n}», así que no se puede mover desde acá. Tenés asignado ${mias}: pedí un traslado.`;
}

/* ---------------------------------------------------------------------------
   Recepción de compras
   La mercancía comprada SOLO entra a Matanzas o Los Pinos: los centros de acopio
   reciben por Traslados, nunca por compra.
   --------------------------------------------------------------------------- */

/** Sedes que pueden recibir compras. */
export const SEDES_RECEPCION = ['CENTRO DE FUNDICION - MATANZAS', 'LOS PINOS'];

/** Los dos únicos destinos de recepción: el almacén principal de cada sede. */
export const DESTINOS_RECEPCION: { label: string; almacen: string; sede: string }[] = [
  { label: 'LOS PINOS', almacen: 'Los Pinos', sede: 'LOS PINOS' },
  { label: 'MATANZA', almacen: 'General', sede: 'CENTRO DE FUNDICION - MATANZAS' },
];

/** Destinos visibles para este usuario: si está sectorizado, solo sus sedes. */
export function opcionesRecepcion(sedesPermitidas?: string[] | null): typeof DESTINOS_RECEPCION {
  const permit = sedesPermitidas?.length ? sedesPermitidas : SEDES_RECEPCION;
  return DESTINOS_RECEPCION.filter((d) => permit.includes(d.sede));
}

/**
 * Sede(s) a la(s) que este usuario recibe y su almacén destino por defecto.
 * `null` = usuario sin restricción (elige libremente). Si el almacén configurado
 * no existe, cae al primer almacén raíz no-casiterita de su sede.
 */
export function destinoRecepcionPorUsuario(
  u: UsuarioSectorizable | null | undefined,
  almacenes: Almacen[],
): { sedes: string[]; almacen: string | null } | null {
  const sedes = sedesDeUsuario(u);
  if (!sedes) return null;
  const configurado = String(u?.almacen_recepcion ?? '').trim()
    || RESPALDO_POR_CORREO[(u?.email ?? '').toLowerCase().trim()]?.almacenRecepcion
    || '';
  const existe = (n: string) => !!n && almacenes.some((a) => a.nombre === n && a.estado === 'activo');
  let almacen: string | null = existe(configurado) ? configurado : null;
  if (!almacen) {
    const s = sedes[0];
    const p = almacenes.find((a) => a.estado === 'activo' && !a.parent_id
      && !/casiterita/i.test(a.nombre) && (a.sede?.trim() || '') === s);
    almacen = p?.nombre ?? null;
  }
  return { sedes, almacen };
}
