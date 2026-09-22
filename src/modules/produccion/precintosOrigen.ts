import type { ColadaDatos, RefinacionDatos } from '@/shared/lib/types';

/* ============================================================
   MGG · El precinto viaja con el material
   ------------------------------------------------------------
   El precinto es lo único que identifica FÍSICAMENTE un bulto de casiterita:
   es el número que va en el saco. Hasta ahora moría en la colada — la
   refinación mostraba «Colada #1» y nada más—, así que para saber de qué saco
   salió un lingote había que abrir la colada a mano.

   Acá se sacan los precintos de cada eslabón para que la cadena se lea de
   punta a punta: saco → colada → refinación.

   Esto NO mueve inventario. Es trazabilidad: el descuento ya lo hizo la
   colada cuando tomó el big bag.
   ============================================================ */

const limpio = (v: unknown): string => String(v ?? '').trim();

/** Quita repetidos y vacíos conservando el orden en que se cargaron. */
function unicos(vs: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const vistos = new Set<string>();
  for (const v of vs) {
    const s = limpio(v);
    if (!s) continue;
    const k = s.toUpperCase();
    if (vistos.has(k)) continue;
    vistos.add(k);
    out.push(s);
  }
  return out;
}

/** Los precintos de los big bags de casiterita que entraron a una colada. */
export function precintosDeColada(datos: ColadaDatos | null | undefined): string[] {
  return unicos((datos?.big_bags ?? []).map((b) => b?.precinto));
}

/**
 * El precinto de una refinación ya terminada.
 * Es el del LOTE FINAL (el que se le estampa al lingote), no el de la
 * casiterita: cuando esa refinación se vuelve a refinar, lo que entra al
 * crisol es el lingote, y ese es el número que hay que poder seguir.
 */
export function precintosDeRefinacion(datos: RefinacionDatos | null | undefined): string[] {
  return unicos([datos?.n_precinto]);
}

/**
 * Los precintos para mostrar en una celda, recortados.
 * Con quince sacos la lista no entra en ningún lado y tampoco se lee; se
 * muestran los primeros y se dice cuántos faltan.
 */
export function resumenPrecintos(precintos: string[], tope = 3): string {
  const ps = unicos(precintos);
  if (!ps.length) return '';
  if (ps.length <= tope) return ps.join(', ');
  return `${ps.slice(0, tope).join(', ')} +${ps.length - tope} más`;
}

/** La lista completa, para el título emergente y para el PDF. */
export function listaPrecintos(precintos: string[]): string {
  return unicos(precintos).join(', ');
}
