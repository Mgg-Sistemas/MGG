/* ============================================================
   MGG · Inventario · Productos sin costo
   Reglas puras de la cola de valuación.

   Un producto puede tener stock y costo 0 por dos vías: una carga
   masiva escrita directo en `existencias` (sin kardex) o una entrada
   registrada sin costo. En ambos casos el almacén queda subvaluado:
   el material está físicamente pero vale $0 en todos los reportes.

   Este módulo decide QUÉ filas hay que valorar y CON QUÉ precio se
   pueden sugerir, sin tocar la base. Así la regla es testeable.
   ============================================================ */

/** Fila de `existencias` cruzada con su producto. */
export interface FilaExistencia {
  producto_id: string;
  almacen: string;
  stock: number | null;
  costo_promedio: number | null;
  sku: string;
  nombre: string;
  unidad?: string | null;
  categoria?: string | null;
}

/** Precio hallado en el historial de compras, para sugerir. */
export interface PrecioHistorico {
  sku: string;
  precio: number;
  /** Código de la orden de donde salió (se muestra al usuario). */
  origen: string;
}

export interface FilaSinCosto extends FilaExistencia {
  stock: number;
  /** Precio sugerido del historial, si lo hay. */
  sugerido: number | null;
  /** De dónde salió el sugerido (p. ej. «OC-2026-0124»). */
  sugeridoOrigen: string | null;
}

/**
 * Filas que necesitan valuación: hay material contado pero vale $0.
 *
 * Se exige `stock > 0` a propósito. Una existencia en 0 con costo 0 es
 * normal (producto anclado a su almacén sin stock, o consumido por
 * completo) y meterla en la cola sería ruido que nunca se puede cerrar.
 */
export function filasSinCosto(
  filas: FilaExistencia[],
  historico: PrecioHistorico[] = [],
): FilaSinCosto[] {
  const porSku = new Map<string, PrecioHistorico>();
  for (const h of historico) {
    const precio = Number(h.precio) || 0;
    if (precio <= 0) continue;
    // Ante varios precios para el mismo SKU gana el más alto: subvalorar el
    // inventario es el error que estamos corrigiendo, no conviene repetirlo.
    const prev = porSku.get(h.sku);
    if (!prev || precio > prev.precio) porSku.set(h.sku, { ...h, precio });
  }

  return (filas ?? [])
    .filter((f) => (Number(f.stock) || 0) > 0 && (Number(f.costo_promedio) || 0) <= 0)
    .map((f) => {
      const sug = porSku.get(f.sku) ?? null;
      return {
        ...f,
        stock: Number(f.stock) || 0,
        sugerido: sug ? sug.precio : null,
        sugeridoOrigen: sug ? sug.origen : null,
      };
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es') || a.almacen.localeCompare(b.almacen, 'es'));
}

/** Clave estable de una fila (una existencia = producto + almacén). */
export const claveFila = (f: { producto_id: string; almacen: string }) => `${f.producto_id}|${f.almacen}`;

/**
 * Valor que el inventario recupera si se guardan los costos tipeados.
 * Sirve para que la pantalla muestre en vivo cuánto se está corrigiendo.
 */
export function valorRecuperado(
  filas: Pick<FilaSinCosto, 'producto_id' | 'almacen' | 'stock'>[],
  costos: Map<string, number>,
): number {
  let total = 0;
  for (const f of filas) {
    const c = Number(costos.get(claveFila(f))) || 0;
    if (c > 0) total += f.stock * c;
  }
  return Math.round(total * 100) / 100;
}

/**
 * Valida un costo tipeado por el usuario. Devuelve el error a mostrar o
 * `null` si sirve. Se rechaza el 0 explícitamente: cargar 0 es justo lo
 * que dejó el inventario así.
 */
export function validarCosto(valor: number): string | null {
  if (!Number.isFinite(valor)) return 'Escribí un número.';
  if (valor <= 0) return 'El costo tiene que ser mayor que 0.';
  if (valor > 1_000_000) return 'Ese costo parece un error de tipeo (más de $1.000.000 por unidad).';
  return null;
}
