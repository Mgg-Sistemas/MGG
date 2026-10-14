/* ============================================================
   MGG · Notificaciones · Cuándo toca escanear el stock (14-10-2026)

   El escaneo de stock crítico baja la tabla `productos` entera (dos páginas)
   más las notificaciones pendientes, e inserta avisos. Corría en CADA arranque
   de CADA usuario: medido, era una de las consultas más repetidas de la base
   (miles de bajadas de productos) y cada aviso insertado hacía recargar el
   contador en todos los navegadores conectados.

   Ahora corre a lo sumo una vez cada 30 minutos por navegador (la marca vive
   en localStorage) y nunca con la pestaña oculta. El stock crítico sigue
   avisándose: medio centenar de usuarios abriendo el sistema a lo largo del
   día lo cubre de sobra.
   ============================================================ */

export const INTERVALO_ESCANEO_MS = 30 * 60 * 1000;
export const CLAVE_ULTIMO_ESCANEO = 'mgg.escaneoStock.ultimo';

/** ¿Toca escanear? Sí cuando no hay marca, la marca no se entiende o ya pasó el intervalo. */
export function tocaEscanear(ultimo: string | null | undefined, ahora = Date.now(), intervalo = INTERVALO_ESCANEO_MS): boolean {
  const t = Number(ultimo);
  if (!ultimo || !Number.isFinite(t) || t <= 0) return true;
  // Una marca en el futuro (reloj cambiado) no puede bloquear para siempre.
  if (t > ahora) return true;
  return ahora - t >= intervalo;
}

export function leerUltimoEscaneo(): string | null {
  try { return localStorage.getItem(CLAVE_ULTIMO_ESCANEO); } catch { return null; }
}

export function marcarEscaneo(ahora = Date.now()): void {
  try { localStorage.setItem(CLAVE_ULTIMO_ESCANEO, String(ahora)); } catch { /* modo privado */ }
}
