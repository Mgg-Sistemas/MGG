/* ============================================================
   MGG · Pantallas de teléfono por rol (13-10-2026, traído de Golden Touch)

   Cada pantalla de teléfono se da POR ROL, una por una, en Usuarios → Roles y
   Permisos (casillas «📱 Pantallas de teléfono»). Se guarda en
   `roles_permisos.vistas_telefono`. Para abrir una hace falta la pantalla Y
   lectura en su módulo: la pantalla no da permiso sobre los datos, eso lo
   sigue dando el módulo (y la base lo exige con is_operativo / el permiso).

   «Solo teléfono» (marca del rol en `custom_roles.solo_telefono`): el rol
   trabaja solo desde sus pantallas de teléfono y no ve las de PC, salvo
   Ajustes. Antes las pantallas salían solas del permiso del módulo: quien
   tenía Combustible veía el Surtidor aunque fuera de escritorio.

   Para sumar una pantalla nueva: agregarla a VISTAS_TELEFONO con su ruta y su
   módulo, y envolver su ruta en <RequireVistaTelefono>.
   ============================================================ */
import type { ModuleKey } from '@/modules/usuarios/permisos.repository';

export type VistaTelefonoKey = 'surtidor' | 'comidas';

export interface VistaTelefono {
  key: VistaTelefonoKey;
  label: string;
  descripcion: string;
  /** Módulo del que salen los datos: hace falta lectura en él para abrirla. */
  modulo: ModuleKey;
  ruta: string;
  icono: string;
}

export const VISTAS_TELEFONO: VistaTelefono[] = [
  {
    key: 'surtidor', label: 'Surtidor de combustible', icono: '⛽', modulo: 'combustible',
    ruta: '/app/combustible/surtidor', descripcion: 'Surtir a un equipo, pasar a otro tanque y entradas',
  },
  {
    key: 'comidas', label: 'Comidas', icono: '🍳', modulo: 'cocina',
    ruta: '/app/cocina/telefono', descripcion: 'Desayuno, almuerzo y cena, con lo consumido y las personas',
  },
];

/** La pantalla de inicio de quien tiene más de una pantalla de teléfono. */
export const RUTA_TELEFONO = '/app/telefono';

const CLAVES = new Set<string>(VISTAS_TELEFONO.map((v) => v.key));

/** Lo guardado en la base, limpio: solo claves conocidas y sin repetir. */
export function normalizarVistas(v: unknown): VistaTelefonoKey[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((x): x is VistaTelefonoKey => typeof x === 'string' && CLAVES.has(x)))];
}

/**
 * Las pantallas que el usuario puede abrir: las de su rol que además tengan lectura
 * en su módulo. El administrador las tiene todas.
 */
export function vistasPermitidas(
  vistasDelRol: readonly string[], can: (m: ModuleKey) => boolean, isAdmin: boolean,
): VistaTelefono[] {
  return VISTAS_TELEFONO.filter((v) => isAdmin || (vistasDelRol.includes(v.key) && can(v.modulo)));
}

/** Adónde entra un rol «solo teléfono»: directo a su pantalla si tiene una, o al menú si tiene varias. */
export function inicioTelefono(vistas: readonly VistaTelefono[]): string {
  return vistas.length === 1 ? vistas[0].ruta : RUTA_TELEFONO;
}

/**
 * ¿Entra por el teléfono? Regla de la administradora (13-10-2026): quien tiene
 * una pantalla de teléfono dada en su rol (p. ej. el Surtidor) ENTRA por ella al
 * iniciar sesión, sea o no «solo teléfono»; el escritorio le queda en el menú y
 * en «🖥 Módulo completo». El administrador entra siempre por el escritorio.
 */
export function entraPorTelefono(o: { isAdmin: boolean; soloTelefono: boolean; vistas: readonly VistaTelefono[] }): boolean {
  if (o.isAdmin) return false;
  return o.soloTelefono || o.vistas.length > 0;
}
