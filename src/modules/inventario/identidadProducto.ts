/* ============================================================
   MGG · Inventario · La marca y el modelo llegan con la mercancía

   La marca y el modelo se cargan en la solicitud de compra, viajan hasta
   la oferta y quedan en la orden. Pero la FICHA del producto nunca se
   enteraba: de 45 órdenes con marca, ninguna se la pasó al inventario.
   Todas las fichas quedaron con marca y modelo vacíos, incluso las de
   órdenes ya recibidas.

   Acá se decide qué se le escribe a la ficha cuando llega la mercancía.

   La regla es LLENAR LO VACÍO, nunca pisar:
   · Ficha sin marca + orden con marca → la ficha toma la de la orden.
   · Ficha con marca → se respeta, aunque esta compra sea de otra.

   Lo segundo importa: una ficha es UN producto con todo su stock. Si hoy
   se compran botas SAGA y el mes pasado UNDER ARMOUR, reescribir la marca
   haría que todo el stock viejo pase a llamarse como la compra nueva. Si
   de verdad son productos distintos, son dos fichas.
   ============================================================ */

export interface IdentidadFicha {
  marca?: string | null;
  modelo?: string | null;
  descripcion?: string | null;
}

const limpio = (v: string | null | undefined): string => (v ?? '').toString().trim();

/** ¿La ficha ya tiene este dato? */
export function tiene(v: string | null | undefined): boolean {
  return limpio(v).length > 0;
}

/**
 * Qué campos de identidad hay que escribirle a la ficha al recibir.
 *
 * Devuelve solo lo que falta, o `null` cuando no hay nada que hacer — que es
 * el caso normal y evita un UPDATE por cada renglón recibido.
 */
export function identidadAlRecibir(ficha: IdentidadFicha | null | undefined, item: IdentidadFicha | null | undefined): IdentidadFicha | null {
  const patch: IdentidadFicha = {};

  const marcaItem = limpio(item?.marca);
  if (marcaItem && !tiene(ficha?.marca)) patch.marca = marcaItem;

  const modeloItem = limpio(item?.modelo);
  if (modeloItem && !tiene(ficha?.modelo)) patch.modelo = modeloItem;

  // La descripción es lo que se lee en los listados y en los papeles: si está
  // vacía, la marca y el modelo la escriben. Una descripción ya redactada no se
  // toca — ahí hay algo que alguien quiso decir.
  //
  // Se arma con la identidad que va a QUEDAR, no con la del renglón: si la ficha
  // ya decía TOLSEN y esta compra es STANLEY, la marca que manda sigue siendo
  // TOLSEN y la descripción tiene que decir eso, no contradecir a la ficha.
  // Y solo se escribe cuando esta recepción aportó algo: si no aportó nada, no
  // tiene por qué redactarle la descripción a una ficha que ya estaba completa.
  if (patch.marca || patch.modelo) {
    const marcaFinal = tiene(ficha?.marca) ? limpio(ficha?.marca) : marcaItem;
    const modeloFinal = tiene(ficha?.modelo) ? limpio(ficha?.modelo) : modeloItem;
    const desc = descripcionDe(marcaFinal, modeloFinal);
    if (desc && !tiene(ficha?.descripcion)) patch.descripcion = desc;
  }

  return Object.keys(patch).length ? patch : null;
}

/** «Marca: SAGA · Modelo: 15W». Vacío si no hay ninguno de los dos. */
export function descripcionDe(marca: string | null | undefined, modelo: string | null | undefined): string {
  const m = limpio(marca), mo = limpio(modelo);
  return [m ? `Marca: ${m}` : '', mo ? `Modelo: ${mo}` : ''].filter(Boolean).join(' · ');
}
