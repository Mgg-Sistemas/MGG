/* ============================================================
   Inventario · Árbol de almacenes (función pura)
   Arma la estructura Sede → Almacén raíz → Sub-almacenes (anidado)
   a partir de la tabla `almacenes` (jerarquía por parent_id), acotado
   a un conjunto de sedes. Usado por el panel lateral de Inventario.
   ============================================================ */
import type { Almacen } from '@/shared/lib/types';

export interface NodoArbol {
  id: string;
  nombre: string;
  sede: string;
  hijos: NodoArbol[];
}

export interface SedeArbol {
  sede: string;
  nodos: NodoArbol[]; // almacenes raíz de la sede (con sus hijos anidados)
}

const sedeDe = (a: Almacen): string => (a.sede?.trim() || 'Sin sede');

/**
 * Construye el árbol de almacenes agrupado por sede, incluyendo solo las
 * `sedesIncluidas`. Cada sede lista sus almacenes RAÍZ (parent_id nulo, o cuyo
 * padre no está dentro de la sede) con sus sub-almacenes anidados por parent_id.
 * Todo ordenado alfabéticamente por nombre.
 */
export function construirArbol(almacenes: Almacen[], sedesIncluidas: string[]): SedeArbol[] {
  const incluidas = new Set(sedesIncluidas.map((s) => s.trim()));
  const delSet = almacenes.filter((a) => incluidas.has(sedeDe(a)));
  const idsEnSet = new Set(delSet.map((a) => a.id));

  // Hijos por padre (solo dentro del set).
  const hijosDe = (parentId: string | null): NodoArbol[] =>
    delSet
      .filter((a) => (a.parent_id ?? null) === parentId)
      .sort((x, y) => x.nombre.localeCompare(y.nombre))
      .map((a) => ({ id: a.id, nombre: a.nombre, sede: sedeDe(a), hijos: hijosDe(a.id) }));

  // Raíces: sin padre, o con un padre que no pertenece al set (huérfano lógico).
  const esRaiz = (a: Almacen): boolean => {
    const p = a.parent_id ?? null;
    return p === null || !idsEnSet.has(p);
  };

  const porSede = new Map<string, NodoArbol[]>();
  for (const a of delSet) {
    if (!esRaiz(a)) continue;
    const s = sedeDe(a);
    const arr = porSede.get(s) ?? [];
    arr.push({ id: a.id, nombre: a.nombre, sede: s, hijos: hijosDe(a.id) });
    porSede.set(s, arr);
  }

  return [...porSede.entries()]
    .map(([sede, nodos]) => ({ sede, nodos: nodos.sort((x, y) => x.nombre.localeCompare(y.nombre)) }))
    .sort((a, b) => a.sede.localeCompare(b.sede));
}

/** Nombres de todos los almacenes (con sub-almacenes) bajo un nodo, incluido él. */
export function nombresBajoNodo(nodo: NodoArbol): string[] {
  const out = [nodo.nombre];
  for (const h of nodo.hijos) out.push(...nombresBajoNodo(h));
  return out;
}
