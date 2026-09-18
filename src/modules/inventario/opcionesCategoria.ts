import type { SearchOption } from '@/shared/ui/SearchSelect';
import type { Producto } from '@/shared/lib/types';
import { prefijoCategoria } from './inventario.repository';

/**
 * Opciones del buscador de categorías: cada una muestra su código de SKU y cuántos
 * productos tiene, y se puede encontrar por el nombre, el código, o el nombre / SKU
 * de cualquiera de sus productos («tubo» → PLOMERÍA).
 */
export function opcionesCategoria(categorias: string[], productos: Producto[]): SearchOption[] {
  const porCategoria = new Map<string, Producto[]>();
  for (const p of productos) {
    if (!p.categoria) continue;
    const lista = porCategoria.get(p.categoria) ?? [];
    lista.push(p);
    porCategoria.set(p.categoria, lista);
  }
  return [...categorias]
    .sort((a, b) => a.localeCompare(b, 'es'))
    .map((c) => {
      const suyos = porCategoria.get(c) ?? [];
      const n = suyos.length;
      return {
        value: c,
        label: c,
        hint: `${prefijoCategoria(c, productos)}-… · ${n} ${n === 1 ? 'producto' : 'productos'}`,
        keywords: suyos.flatMap((p) => [p.nombre, p.sku].filter((x): x is string => !!x)),
      };
    });
}
