/* ============================================================
   Golden Touch · Usuarios · Archivo

   Un usuario ARCHIVADO sigue siendo un usuario DESHABILITADO (estado =
   'inactivo'; la base lo exige con `usuarios_archivado_solo_inactivo`),
   solo que además lleva `archivado_en`. Se decidió NO agregar un valor al
   enum `estado_generico`: lo comparten 8 tablas y lo consultan 15 funciones
   de seguridad del servidor (is_admin, is_operativo, auth_hook_token…).
   Con la marca aparte, todas siguen funcionando sin tocarlas.

   Lógica pura, sin red: la usan la pantalla y las pruebas.
   ============================================================ */
import type { Usuario } from '@/shared/lib/types';

/** Lo que se muestra en pantalla: el archivado se distingue del simple deshabilitado. */
export type EstadoUsuarioVisible = 'activo' | 'inactivo' | 'archivado';

/** Filtro del selector de estado. `''` = activos y deshabilitados (sin archivados). */
export type FiltroEstadoUsuario = EstadoUsuarioVisible | '';

type ConEstado = Pick<Usuario, 'estado'> & Partial<Pick<Usuario, 'archivado_en'>>;

export function estaArchivado(u: Partial<Pick<Usuario, 'archivado_en'>>): boolean {
  return u.archivado_en != null && u.archivado_en !== '';
}

export function estadoVisible(u: ConEstado): EstadoUsuarioVisible {
  if (estaArchivado(u)) return 'archivado';
  return u.estado === 'activo' ? 'activo' : 'inactivo';
}

/** Solo se archiva un usuario que ya está deshabilitado (y no archivado aún). */
export function puedeArchivar(u: ConEstado): boolean {
  return u.estado === 'inactivo' && !estaArchivado(u);
}

/** Solo se restaura un archivado; vuelve como deshabilitado, no como activo. */
export function puedeRestaurar(u: ConEstado): boolean {
  return estaArchivado(u);
}

/**
 * Sin filtro (`''`) los archivados NO aparecen: es el objetivo de la función.
 * Con filtro, se compara contra el estado visible.
 */
export function filtrarPorEstado<T extends ConEstado>(usuarios: T[], filtro: FiltroEstadoUsuario): T[] {
  if (filtro === '') return usuarios.filter((u) => !estaArchivado(u));
  return usuarios.filter((u) => estadoVisible(u) === filtro);
}
