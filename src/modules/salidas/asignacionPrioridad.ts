/* ============================================================
   Salidas · Asignación de stock por PRIORIDAD de almacén.
   En una salida desde la lista general de productos, el sistema
   descuenta del almacén de MAYOR prioridad que tenga stock y, si
   no alcanza, cascada al siguiente. El orden lo fija la SEDE del
   almacén: Los Pinos primero, luego Matanzas y, al final, el
   resto (centros de acopio) — desempatando por más stock.
   ============================================================ */

/** Orden de prioridad por sede (índice menor = sale primero). Se compara en MAYÚSCULAS y sin espacios. */
export const SEDE_PRIORIDAD: string[] = ['LOS PINOS', 'CENTRO DE FUNDICION - MATANZAS'];

/** Rango de una sede: su posición en SEDE_PRIORIDAD; las no listadas van al final. */
export function rangoSede(sede: string | null | undefined): number {
  const key = (sede ?? '').trim().toUpperCase();
  const i = SEDE_PRIORIDAD.indexOf(key);
  return i === -1 ? SEDE_PRIORIDAD.length : i;
}

export interface CandidatoAlmacen {
  almacen: string;
  sede: string | null;
  stock: number;
  costo: number;
}

export interface AsignacionSalida {
  almacen: string;
  cantidad: number;
  stock: number;
  costo: number;
}

/**
 * Reparte `cantidad` entre los almacenes con stock, en orden de prioridad
 * (rango de sede asc, luego más stock primero). Devuelve los tramos que
 * cubren la cantidad; `faltante` es lo que no se pudo cubrir (0 si todo ok).
 */
export function planEntregaPorPrioridad(
  candidatos: CandidatoAlmacen[],
  cantidad: number,
): { tramos: AsignacionSalida[]; faltante: number } {
  const orden = candidatos
    .filter((c) => (Number(c.stock) || 0) > 0)
    .sort((a, b) => rangoSede(a.sede) - rangoSede(b.sede) || (Number(b.stock) || 0) - (Number(a.stock) || 0));
  const tramos: AsignacionSalida[] = [];
  let resto = Math.max(0, Number(cantidad) || 0);
  for (const c of orden) {
    if (resto <= 0) break;
    const toma = Math.min(resto, Number(c.stock) || 0);
    if (toma <= 0) continue;
    tramos.push({ almacen: c.almacen, cantidad: toma, stock: Number(c.stock) || 0, costo: Number(c.costo) || 0 });
    resto = Math.round((resto - toma) * 1e6) / 1e6;
  }
  return { tramos, faltante: resto };
}

/** Stock total disponible de un producto sumando todos sus almacenes. */
export function stockTotal(candidatos: CandidatoAlmacen[]): number {
  return candidatos.reduce((a, c) => a + (Number(c.stock) || 0), 0);
}
