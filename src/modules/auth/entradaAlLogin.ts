/* ============================================================
   MGG · Auth · qué hacer al abrir la pantalla de login
   ------------------------------------------------------------
   Esta pantalla cerraba la sesión al montarse, para obligar a
   autenticarse siempre. El problema: el token vive en el storage
   del navegador, que es COMPARTIDO entre pestañas. Así que abrir
   el login en una pestaña —o recargarlo— mataba la sesión de la
   pestaña donde el usuario estaba trabajando.

   La regla correcta: si ya hay sesión, no se cierra, se entra.
   Solo se limpia el storage cuando NO hay sesión válida, que es
   cuando puede haber restos de un token vencido y no hay ninguna
   otra pestaña a la que perjudicar.

   Para entrar con otro usuario está «Cerrar sesión», que es el
   camino explícito y no depende de recargar una pantalla.
   ============================================================ */

/** Lo mínimo que hace falta saber de la sesión para decidir. */
export interface SesionMinima {
  user?: { id?: string | null } | null;
}

export type EntradaAlLogin =
  /** Ya hay sesión: se entra a la app sin tocarla. */
  | 'entrar'
  /** No hay sesión: se limpian restos y se muestra el formulario. */
  | 'pedir-credenciales';

export function decidirEntradaAlLogin(sesion: SesionMinima | null | undefined): EntradaAlLogin {
  return sesion?.user?.id ? 'entrar' : 'pedir-credenciales';
}

/**
 * Cuánto se espera a saber si hay sesión antes de mostrar el formulario igual.
 * Leer la sesión es una lectura local y tarda milisegundos; el tope existe para
 * que un fallo raro nunca deje al usuario mirando una pantalla en blanco.
 */
export const ESPERA_MAXIMA_MS = 2500;
