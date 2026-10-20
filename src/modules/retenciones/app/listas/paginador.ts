/* ============================================================
   Retenciones · El paginador numerado (R3-3), lógica pura

   Traslado de la maqueta v8 (`v8-3-listas.js`: `v8NumerosPagina`,
   `v7Paginas`, `v8IrPagina`). Una sola regla para todas las listas:
   primera · anterior · números con elipsis · siguiente · última,
   «Ir a la página», «Mostrando X–Y de N» y filas por página 25/50/100.
   Sin «Cargar más» en ninguna lista.
   ============================================================ */

/** Filas por página que se ofrecen: una sola elección para todas las listas. */
export const TAMANOS_PAGINA = [25, 50, 100] as const;
export const TAMANO_PAGINA_INICIAL = 25;

/** La marca de los números que no se muestran. */
export const ELIPSIS = '…' as const;
export type NumeroOElipsis = number | typeof ELIPSIS;

/** Formato de los números en pantalla («3.730»). */
export const nf = (n: number): string => Number(n).toLocaleString('es-VE');

/** Cuántas páginas hay (al menos una, aunque la lista esté vacía). */
export function numeroDePaginas(total: number, tamano: number): number {
  const t = Math.max(1, Math.floor(tamano) || 1);
  return Math.max(1, Math.ceil(Math.max(0, total) / t));
}

/** La página pedida, dentro de 1…n. */
export function acotarPagina(pagina: number, paginas: number): number {
  const p = Math.round(Number(pagina)) || 1;
  return Math.min(Math.max(1, p), Math.max(1, paginas));
}

/**
 * Los números que se muestran: la primera, la última, la actual con sus
 * vecinas y, cerca de un extremo, las cuatro primeras o las cuatro últimas.
 * Entre dos números no seguidos va una elipsis.
 * Ej.: página 1 de 150 → 1 2 3 4 … 150; página 23 de 150 → 1 … 22 23 24 … 150.
 */
export function numerosPagina(pagina: number, paginas: number): NumeroOElipsis[] {
  const n = Math.max(1, paginas);
  const pag = acotarPagina(pagina, n);
  const s = new Set<number>([1, n, pag - 1, pag, pag + 1]);
  if (pag <= 3) [2, 3, 4].forEach((x) => s.add(x));
  if (pag >= n - 2) [n - 1, n - 2, n - 3].forEach((x) => s.add(x));
  const xs = [...s].filter((x) => x >= 1 && x <= n).sort((a, b) => a - b);
  const out: NumeroOElipsis[] = [];
  xs.forEach((x, i) => {
    if (i && x - xs[i - 1] > 1) out.push(ELIPSIS);
    out.push(x);
  });
  return out;
}

/** Desde qué fila y hasta cuál se muestran (1-based). Sin filas: 0 y 0. */
export function rangoVisible(total: number, pagina: number, tamano: number): { desde: number; hasta: number } {
  if (!total) return { desde: 0, hasta: 0 };
  const pag = acotarPagina(pagina, numeroDePaginas(total, tamano));
  return { desde: (pag - 1) * tamano + 1, hasta: Math.min(total, pag * tamano) };
}

/** «Mostrando 551–575 de 3.730» o «Sin resultados». */
export function textoMostrando(total: number, pagina: number, tamano: number): string {
  if (!total) return 'Sin resultados';
  const { desde, hasta } = rangoVisible(total, pagina, tamano);
  return `Mostrando ${nf(desde)}–${nf(hasta)} de ${nf(total)}`;
}

/** Las filas de una página, con la página ya acotada y el total de páginas. */
export function paginar<T>(xs: readonly T[], pagina: number, tamano: number): { filas: T[]; pagina: number; paginas: number } {
  const paginas = numeroDePaginas(xs.length, tamano);
  const pag = acotarPagina(pagina, paginas);
  return { filas: xs.slice((pag - 1) * tamano, pag * tamano), pagina: pag, paginas };
}

/** Un botón de destino: no se puede ir fuera de 1…n ni a la página actual. */
export function destinoDeshabilitado(destino: number, pagina: number, paginas: number): boolean {
  return destino < 1 || destino > paginas || destino === pagina;
}

/**
 * Lo escrito en «Ir a la página»: el número (redondeado) si cae en 1…max;
 * si no, null (la pantalla avisa «Indique una página entre 1 y N»).
 */
export function leerIrPagina(valor: string | number | null | undefined, max: number): number | null {
  if (valor == null || String(valor).trim() === '') return null;
  const n = Math.round(Number(valor));
  return n >= 1 && n <= max ? n : null;
}

/** El aviso cuando «Ir a la página» no es válido. */
export const avisoIrPagina = (max: number): string => `Indique una página entre 1 y ${nf(max)}.`;

/** El selector de filas aparece si el tamaño es uno de los ofrecidos y hay más filas que el menor. */
export function mostrarSelectorFilas(tamano: number, total: number): boolean {
  return (TAMANOS_PAGINA as readonly number[]).includes(tamano) && total > TAMANOS_PAGINA[0];
}

/** El aviso al cambiar las filas por página (vale para todas las listas). */
export const avisoFilas = (tamano: number): string => `${tamano} filas por página en todas las listas.`;
