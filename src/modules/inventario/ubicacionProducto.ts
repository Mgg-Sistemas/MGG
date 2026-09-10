/* ============================================================
   MGG · Inventario · Ubicación de un producto

   Un producto que se da de alta desde una solicitud NO elige almacén:
   la ubicación real nace cuando llega la mercancía y el almacenista
   decide dónde entra (LOS PINOS o MATANZA). Entre el alta y la
   recepción el producto queda «sin ubicación»: existe en el catálogo
   pero no está en ninguna sede, así que hay que mostrarlo marcado en
   vez de dejarlo desaparecer de las vistas por sede.
   ============================================================ */

/** Aviso que se muestra en la ficha y en la lista mientras no tiene almacén. */
export const AVISO_SIN_UBICACION = 'sin ubicación · se define al recibir';

/** Valor del filtro por almacén que trae justamente a los que no tienen ninguno. */
export const FILTRO_SIN_UBICACION = '__sin_ubicacion__';

/** ¿Este producto todavía no tiene almacén de casa? */
export function sinUbicacion(p: { almacen?: string | null }): boolean {
  return String(p?.almacen ?? '').trim() === '';
}

/**
 * Almacén que hay que estampar en la ficha al recibir mercancía, o `null` si no
 * corresponde tocarla.
 *
 * Solo se estampa cuando el producto NO tenía casa: si ya vivía en un almacén,
 * recibir en otro no lo muda — para eso está «⇄ Mover producto». Así una
 * recepción en Matanza de algo que vive en Los Pinos no le cambia la ficha.
 */
export function ubicacionAlRecibir(
  actual: string | null | undefined,
  destino: string | null | undefined,
): string | null {
  if (!sinUbicacion({ almacen: actual })) return null;
  const d = String(destino ?? '').trim();
  return d || null;
}
