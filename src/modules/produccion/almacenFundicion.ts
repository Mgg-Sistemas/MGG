/* ============================================================
   MGG · Fundición · De dónde sale el material de una colada

   El horno está en MATANZA y el material siempre sale de ahí: no
   tiene sentido preguntarlo colada por colada. Se elige solo el
   almacén de Matanza donde el material realmente tiene stock, y si
   no tiene en ninguno, el principal de la sede.
   ============================================================ */

/** Sede donde está el horno. */
export const SEDE_FUNDICION = 'CENTRO DE FUNDICION - MATANZAS';

/** Almacén principal de esa sede: el destino/origen por defecto. */
export const ALMACEN_PRINCIPAL_FUNDICION = 'General';

export interface ExistenciaMin {
  producto_id: string;
  almacen: string;
  stock: number | string | null;
}

/**
 * Almacén de Matanza del que sale un material.
 *
 * Prioriza el almacén donde HAY stock (el de más), porque es el que va a poder
 * despachar; si el material no tiene existencia en ninguno, cae en el principal.
 * Nunca devuelve un almacén de otra sede: el material de fundición sale de
 * Matanza, y sacarlo de Los Pinos sería mover stock de otro centro sin traslado.
 */
export function almacenDeFundicion(
  productoId: string,
  existencias: ExistenciaMin[],
  almacenesMatanza: string[] = [],
): string {
  const permitidos = almacenesMatanza.filter((a) => !!a && a.trim());
  const enSede = new Set(permitidos);
  const conStock = existencias
    .filter((e) => e.producto_id === productoId && (enSede.size === 0 || enSede.has(e.almacen)))
    .map((e) => ({ almacen: e.almacen, stock: Number(e.stock) || 0 }))
    .filter((e) => e.stock > 0)
    .sort((a, b) => b.stock - a.stock);
  if (conStock.length) return conStock[0].almacen;
  if (enSede.has(ALMACEN_PRINCIPAL_FUNDICION)) return ALMACEN_PRINCIPAL_FUNDICION;
  return permitidos[0] ?? ALMACEN_PRINCIPAL_FUNDICION;
}

/* `validaStock` se eliminó: la fundición no descuenta inventario, así que no
   hay nada que reservar y exigir existencia solo trababa el registro de una
   colada que ya había ocurrido. Ver `produccion.repository.ts`. */
