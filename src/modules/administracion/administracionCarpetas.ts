/* Árbol de carpetas de documentos (anidables por parentId). Lógica pura. */
import type { Carpeta } from './admin.repository';

export interface CarpetaNodo extends Carpeta {
  hijos: CarpetaNodo[];
}

/** Arma el árbol de carpetas por `parentId`. Las que no tienen padre (o cuyo padre
 *  no está en la lista) quedan en la raíz. Ordena por `orden` y luego por nombre. */
export function arbolCarpetas(carpetas: Carpeta[]): CarpetaNodo[] {
  const nodos = new Map<string, CarpetaNodo>();
  for (const c of carpetas) nodos.set(c.id, { ...c, hijos: [] });
  const raices: CarpetaNodo[] = [];
  for (const n of nodos.values()) {
    const padre = n.parentId ? nodos.get(n.parentId) : undefined;
    if (padre) padre.hijos.push(n);
    else raices.push(n);
  }
  const ordenar = (arr: CarpetaNodo[]) => {
    arr.sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, 'es'));
    arr.forEach((n) => ordenar(n.hijos));
  };
  ordenar(raices);
  return raices;
}
