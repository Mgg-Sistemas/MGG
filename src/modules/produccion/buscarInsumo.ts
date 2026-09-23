import type { Producto } from '@/shared/lib/types';
import { coincideTodo, formasDeNumero, textoBuscable } from '@/shared/lib/buscar';

/* ============================================================
   MGG · Buscar en la lista de insumos de la receta

   La receta de una colada o de una refinación se arma de una lista larga de
   insumos. Buscar solo por nombre no alcanza: a veces se busca por el SKU que
   está en el saco, por el almacén del que sale, o por la categoría.
   ============================================================ */

/** Lo que la pantalla sabe del insumo además de su ficha. */
export interface DatosInsumo {
  /** Almacén del que saldría (o «piso de fundición»). */
  almacen?: string | null;
  /** Cuántos hay disponibles. */
  disponible?: number | null;
  /** true si hay material entregado en el piso de fundición. */
  enPiso?: boolean;
}

/** Todo el texto de un insumo donde tiene sentido buscar. */
export function textoDeInsumo(p: Producto, d?: DatosInsumo): string {
  const disp = Number(d?.disponible) || 0;
  return textoBuscable([
    p.nombre, p.sku, p.categoria, p.marca, p.modelo, p.unidad, p.descripcion,
    d?.almacen,
    formasDeNumero(d?.disponible),
    // Se puede buscar «sin stock» para ver qué falta, o «piso» para lo que ya
    // se entregó a fundición: son las dos preguntas que se hacen acá.
    disp > 0 ? 'disponible con stock' : 'sin stock agotado',
    d?.enPiso ? 'piso de fundicion entregado' : '',
  ]);
}

/** Filtra los insumos por texto libre. Sin texto, devuelve todo. */
export function filtrarInsumos(
  insumos: Producto[],
  q: string,
  datos?: (p: Producto) => DatosInsumo,
): Producto[] {
  if (!q.trim()) return insumos;
  return insumos.filter((p) => coincideTodo(textoDeInsumo(p, datos?.(p)), q));
}
