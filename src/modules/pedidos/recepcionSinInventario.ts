/* ============================================================
   MGG · Recepción · «sin inventario» es una DECISIÓN de quien recibe

   24-11-2026. Una OC a crédito se recibió desde el teléfono de almacén y
   no sumó stock: la casilla «sin inventario» de una recepción anterior
   quedó pegada en la orden y las pantallas que no la muestran la
   heredaban en silencio. Acá la regla vive en un sitio y se prueba sola:

   · Un SERVICIO nunca mueve stock (no es una decisión del usuario).
   · El stock solo se omite cuando QUIEN RECIBE marca «ya lo cargué a mano»
     en ESTA recepción.

   El flag guardado en la orden (`sin_inventario`) se usa para prellenar la
   casilla y para avisar, nunca para decidir por el usuario.
   ============================================================ */

export interface OpcionesSinInventario {
  /** Lo que marcó quien recibe AHORA (no lo que quedó de otra recepción). */
  sinInventarioMarcado?: boolean | null;
  /** Los servicios no entran al inventario por definición. */
  esServicio?: boolean | null;
}

/** ¿Esta recepción debe NO tocar el inventario? */
export function omitirInventarioAlRecibir(o: OpcionesSinInventario): boolean {
  return o.esServicio === true || o.sinInventarioMarcado === true;
}

/**
 * Estado inicial de la casilla en la pantalla. Si la orden viene de una
 * recepción marcada como «sin inventario», se muestra MARCADA para que quien
 * recibe la vea y pueda desmarcarla; nunca se decide por él en el repository.
 */
export function sinInventarioPorDefecto(sinInventarioGuardado?: boolean | null): boolean {
  return sinInventarioGuardado === true;
}
