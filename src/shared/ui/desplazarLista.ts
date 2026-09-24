/* ============================================================
   MGG · Lista desplegable · que la opción resaltada se vea

   Bajar con las flechas movía el resaltado pero NO la lista: el
   desplegable tiene alto máximo, así que a partir de la quinta o
   sexta opción el resaltado se iba fuera de la parte visible y el
   usuario veía una lista quieta. Parecía que las flechas no hacían
   nada, cuando en realidad estaban recorriendo opciones invisibles.

   La cuenta vive acá, sin DOM, para poder probarla.
   ============================================================ */

export interface Ventana {
  /** Distancia del borde superior de la opción al inicio de la lista. */
  top: number;
  /** Alto de la opción. */
  alto: number;
  /** Cuánto está desplazada la lista ahora. */
  scroll: number;
  /** Alto visible de la lista. */
  visible: number;
}

/**
 * Cuánto tiene que desplazarse la lista para que la opción resaltada se vea
 * entera, moviéndose lo MENOS posible.
 *
 * Si la opción ya está a la vista no se mueve nada: hacerlo daría un salto
 * gratuito en cada flecha. Si se fue por arriba, la lista sube justo hasta
 * ella; si se fue por abajo, baja justo hasta que su borde inferior entre.
 */
export function desplazamientoPara(v: Ventana): number {
  const fin = v.top + v.alto;
  if (v.top < v.scroll) return v.top;                       // se fue por arriba
  if (fin > v.scroll + v.visible) return fin - v.visible;   // se fue por abajo
  return v.scroll;                                          // ya se ve: quieta
}
