/* ============================================================
   MGG · RRHH · Marcar / desmarcar en lote sobre un conjunto de ids

   Lo usan las listas con casillas por persona (plan de descansos, etc.).
   Las dos acciones trabajan sobre LO QUE SE VE: con un departamento
   filtrado, «Marcar todos» marca ese departamento y no toca al resto de la
   selección. Marcar de a uno sigue siendo `alternar`.
   ============================================================ */

/** Agrega los ids visibles a la selección sin perder los que ya estaban. */
export function marcarVisibles(sel: Set<string>, visibles: Iterable<string>): Set<string> {
  return new Set([...sel, ...visibles]);
}

/** Saca de la selección solo los ids visibles. */
export function desmarcarVisibles(sel: Set<string>, visibles: Iterable<string>): Set<string> {
  const fuera = new Set(visibles);
  return new Set([...sel].filter((id) => !fuera.has(id)));
}

/** Marca o desmarca uno solo. */
export function alternar(sel: Set<string>, id: string): Set<string> {
  const out = new Set(sel);
  if (out.has(id)) out.delete(id); else out.add(id);
  return out;
}

/** ¿Están marcados todos los visibles? (para el estado del botón). */
export function todosMarcados(sel: Set<string>, visibles: Iterable<string>): boolean {
  let n = 0;
  for (const id of visibles) { n++; if (!sel.has(id)) return false; }
  return n > 0;
}
