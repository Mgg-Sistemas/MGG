/* ============================================================
   MGG · Recarga que de verdad trae la versión nueva

   El aviso «Actualizando el sistema…» se quedaba pegado: apretabas
   «Recargar ahora», la página recargaba y volvía a aparecer.

   La causa es que `location.reload()` puede volver a servir el
   index.html DE LA CACHÉ, y ese index apunta a los chunks viejos —
   que el despliegue ya borró. La página recarga, pide el mismo chunk
   inexistente, falla igual, y como el guard anti-bucle ve que recién
   se recargó, ya no reintenta: queda el cartel para siempre.

   Acá la recarga cambia la URL con una marca de tiempo. Una URL que
   el navegador nunca vio no puede salir de su caché: baja el index.html
   fresco y con él los chunks nuevos.
   ============================================================ */

/** Parámetro que se usa para forzar el viaje al servidor. */
export const PARAM_RECARGA = '_v';

/**
 * La misma dirección, con una marca de tiempo que la hace nueva para la caché.
 *
 * Reemplaza la marca anterior en vez de encadenarlas: si no, cada intento
 * dejaría una URL más larga que la anterior. El resto de la consulta y el
 * fragmento se conservan — un enlace a una sección tiene que seguir llevando ahí.
 */
export function urlConBust(href: string, ahora: number = Date.now()): string {
  try {
    const url = new URL(href);
    url.searchParams.set(PARAM_RECARGA, String(ahora));
    return url.toString();
  } catch {
    // Sin URL parseable (entornos raros), se arma a mano.
    const base = href.split('#')[0];
    const hash = href.includes('#') ? href.slice(href.indexOf('#')) : '';
    const limpio = base.replace(new RegExp(`([?&])${PARAM_RECARGA}=[^&]*`), '$1').replace(/[?&]$/, '');
    return `${limpio}${limpio.includes('?') ? '&' : '?'}${PARAM_RECARGA}=${ahora}${hash}`;
  }
}

/**
 * Recarga saltando la caché.
 *
 * Usa `replace` y no `assign`: la dirección rota no tiene que quedar en el
 * historial, o el botón «atrás» devuelve al usuario justo al error del que
 * acaba de salir.
 */
export function recargaDura(): void {
  try {
    window.location.replace(urlConBust(window.location.href));
  } catch {
    window.location.reload();
  }
}
