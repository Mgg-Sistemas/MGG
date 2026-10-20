/* ============================================================
   MGG · Retenciones · Impresión · Cortes de página de las relaciones

   La maqueta (v8-16, v8PaginasRelacion) mide las filas reales fuera de
   pantalla y las reparte en hojas carta con la cabecera repetida. Acá el
   reparto es una función pura (se prueba con alturas dadas) y la
   medición del DOM va aparte.

   Las hojas de columnas (la 1.ª y la 2.ª del ejemplar) llevan las mismas
   filas con la misma altura: se toma, fila por fila, la mayor de las dos,
   y se corta igual en las dos. Así la página N de la hoja 2 trae las
   mismas filas que la página N de la hoja 1.
   ============================================================ */

/**
 * Reparte filas de alturas dadas en páginas de `altoPagina`, donde cada
 * página ya ocupa `altoFijo` (cabecera y pie). Una fila que no cabe pasa a
 * la página siguiente; una página nunca queda sin su primera fila. Sin
 * filas, una página vacía. Devuelve los índices de las filas de cada página.
 */
export function partirEnPaginas(alturas: readonly number[], altoPagina: number, altoFijo: number): number[][] {
  const paginas: number[][] = [];
  let actual: number[] = [];
  let usado = altoFijo;
  alturas.forEach((h, i) => {
    if (actual.length && usado + h > altoPagina) {
      paginas.push(actual);
      actual = [];
      usado = altoFijo;
    }
    actual.push(i);
    usado += h;
  });
  paginas.push(actual);
  return paginas;
}

/** Lo que se midió de cada hoja de columnas (una entrada por grupo). */
export interface MedidasRelacion {
  /** Alto de la cabecera más el pie, por grupo. */
  fijo: number[];
  /** Alto de cada fila de datos, por grupo: filas[grupo][fila]. */
  filas: number[][];
  /** Alto de la fila de totales, por grupo (0 si el grupo no la lleva). */
  total: number[];
}

export interface PaginaRelacion {
  /** El grupo de columnas (la hoja del ejemplar), desde 0. */
  grupo: number;
  /** Índices de las filas de datos de esta página. */
  filas: number[];
  /** Si la página cierra con la fila de totales. */
  conTotal: boolean;
}

export interface PaginacionRelacion {
  /** Todas las páginas: primero las de la hoja 1, después las de la hoja 2. */
  paginas: PaginaRelacion[];
  /** La altura de cada fila de datos (la misma en todas las hojas). */
  alturas: number[];
  /** La altura de la fila de totales (0 si ninguna hoja la lleva). */
  alturaTotal: number;
  /** Cuántas hojas de columnas tiene el formato. */
  grupos: number;
}

const mayor = (xs: readonly number[]) => xs.reduce((a, b) => Math.max(a, b), 0);

/** Reparte una relación medida en páginas de `altoPagina`, con los mismos cortes en todas las hojas de columnas. */
export function paginarRelacion(m: MedidasRelacion, altoPagina: number): PaginacionRelacion {
  const grupos = m.filas.length;
  const nFilas = mayor(m.filas.map((f) => f.length));
  const alturas = Array.from({ length: nFilas }, (_, i) => mayor(m.filas.map((f) => f[i] ?? 0)));
  const alturaTotal = mayor(m.total);
  // La fila de totales cuenta como una fila más, al final
  const cortes = partirEnPaginas(alturaTotal > 0 ? [...alturas, alturaTotal] : alturas, altoPagina, mayor(m.fijo));
  const paginas: PaginaRelacion[] = [];
  for (let g = 0; g < grupos; g++) {
    for (const corte of cortes) {
      paginas.push({ grupo: g, filas: corte.filter((i) => i < nFilas), conTotal: alturaTotal > 0 && corte.includes(nFilas) });
    }
  }
  return { paginas, alturas, alturaTotal, grupos };
}

/**
 * Mide una relación ya montada (fuera de pantalla): una tabla `table.rv8-t`
 * por hoja de columnas, con la cabecera en el thead, el pie en el tfoot y
 * la fila de totales con la clase `rv8-tot`.
 */
export function medirRelacion(raiz: ParentNode): MedidasRelacion {
  const tablas = Array.from(raiz.querySelectorAll<HTMLTableElement>('table.rv8-t'));
  const alto = (el: Element | null | undefined) => (el ? el.getBoundingClientRect().height : 0);
  return {
    fijo: tablas.map((t) => alto(t.tHead) + alto(t.tFoot)),
    filas: tablas.map((t) => Array.from(t.tBodies[0]?.rows ?? []).filter((tr) => !tr.classList.contains('rv8-tot')).map((tr) => alto(tr))),
    total: tablas.map((t) => alto(t.tBodies[0]?.querySelector('tr.rv8-tot'))),
  };
}
