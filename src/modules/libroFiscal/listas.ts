/* ============================================================
   Golden Touch · Libro fiscal · Listas: paginar, buscar, filtrar y contar

   Piezas puras de las listas del módulo (paginador numerado, búsqueda,
   filtros con su conteo y orden), para probarlas sin pantalla.
   ============================================================ */
import { norm } from '@/shared/lib/texto';

export const TAMANOS_PAGINA = [25, 50, 100] as const;

/** Los números que muestra el paginador: el primero, el último y los vecinos de la actual; los huecos, «…». */
export function numerosPagina(pag: number, total: number): Array<number | '…'> {
  const n = Math.max(1, total);
  const s = new Set([1, n, pag - 1, pag, pag + 1]);
  if (pag <= 3) [2, 3, 4].forEach((x) => s.add(x));
  if (pag >= n - 2) [n - 1, n - 2, n - 3].forEach((x) => s.add(x));
  const xs = [...s].filter((x) => x >= 1 && x <= n).sort((a, b) => a - b);
  const out: Array<number | '…'> = [];
  xs.forEach((x, i) => { if (i && x - xs[i - 1] > 1) out.push('…'); out.push(x); });
  return out;
}

export interface Pagina<T> {
  filas: T[];
  pag: number;
  paginas: number;
  desde: number;
  hasta: number;
  total: number;
}

/** La página `pag` (ajustada al rango) de una lista ya filtrada y ordenada. */
export function paginar<T>(xs: T[], pag: number, tam: number): Pagina<T> {
  const total = xs.length;
  const paginas = Math.max(1, Math.ceil(total / Math.max(1, tam)));
  const p = Math.min(Math.max(1, Math.trunc(pag) || 1), paginas);
  const desde = total ? (p - 1) * tam + 1 : 0;
  const hasta = Math.min(total, p * tam);
  return { filas: xs.slice((p - 1) * tam, p * tam), pag: p, paginas, desde, hasta, total };
}

/** ¿Algún campo contiene la búsqueda? Sin tildes ni mayúsculas. */
export function buscaEn(q: string, ...campos: Array<string | number | null | undefined>): boolean {
  const n = norm(q);
  return !n || campos.some((c) => norm(c == null ? '' : String(c)).includes(n));
}

export interface FiltroLista<T> {
  campo: string;
  etiqueta: string;
  valor: string;
  opciones: Array<[valor: string, texto: string]>;
  pasa: (x: T, valor: string) => boolean;
}

/** Cuántas filas quedan con cada opción de un filtro, con los DEMÁS filtros puestos. */
export function conteoOpcion<T>(base: T[], filtros: FiltroLista<T>[], campo: string, valor: string): number {
  const f = filtros.find((x) => x.campo === campo);
  return base.filter((x) => filtros.every((o) => o.campo === campo || !o.valor || o.pasa(x, o.valor)) && (!f || f.pasa(x, valor))).length;
}

/** Las filas que pasan todos los filtros puestos. */
export function aplicarFiltros<T>(base: T[], filtros: FiltroLista<T>[]): T[] {
  return base.filter((x) => filtros.every((o) => !o.valor || o.pasa(x, o.valor)));
}
