/* ============================================================
   MGG · Fundición · La escoria vuelve al inventario

   Una colada no produce solo estaño: deja ESCORIA, que no es basura
   — se vuelve a fundir. Por eso entra al inventario como materia
   prima (MP) y queda disponible como insumo de receta, igual que el
   coque o la caliza.

   Entra SIN COSTO: lo que costó la colada ya está cargado en el
   estaño obtenido, y repartirlo entre los dos sería inventar un
   reparto. Queda en la cola «⚠ Sin costo» del inventario para que
   alguien le ponga precio con criterio.
   ============================================================ */

/** Nombre exacto de la ficha del inventario donde entra la escoria. */
export const NOMBRE_ESCORIA = 'ESCOREA DE FUNDICION';

/** Categoría con la que vive en el inventario: materia prima. */
export const CATEGORIA_ESCORIA = 'MP';

/** Unidad en la que se pesa. */
export const UNIDAD_ESCORIA = 'KILOGRAMO';

/**
 * Kg de escoria que entran al inventario por una colada.
 *
 * Devuelve 0 cuando no hay nada que ingresar: sin dato, en cero, negativo o
 * ilegible. Cero significa «no muevas el inventario», no «registra una entrada
 * vacía»: un movimiento de 0 kg ensucia el kardex sin decir nada.
 */
export function kgDeEscoria(escoriaKg: number | null | undefined): number {
  const n = Number(escoriaKg);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 1000) / 1000;
}

/**
 * ¿Esta colada tiene que ingresar su escoria?
 *
 * No lo hace si la colada está marcada para no sumar al inventario: en ese caso
 * la orden es un registro/reporte (una carga vieja, por ejemplo) y el stock de
 * hoy ya refleja lo que quedó. Sumar la escoria ahí la contaría dos veces.
 */
export function ingresaEscoria(escoriaKg: number | null | undefined, sumarInventario: boolean | null | undefined): boolean {
  if (sumarInventario === false) return false;
  return kgDeEscoria(escoriaKg) > 0;
}

/** Texto del movimiento, para que el kardex se explique solo. */
export function detalleEscoria(coladaNum: number | string | null | undefined): string {
  const n = String(coladaNum ?? '').trim();
  return n
    ? `Escoria obtenida en la colada N° ${n} · vuelve a fundición como materia prima`
    : 'Escoria obtenida en una colada · vuelve a fundición como materia prima';
}
